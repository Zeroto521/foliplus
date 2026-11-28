import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Production sources carry no type-system bypasses. Measured here at build time,
// not in tsc, because these are text properties: no checker reports the number
// of `as any` in the tree.
//
// These are not lint duplicates — eslint's ban-ts-comment only flags @ts-*
// lines it can classify, and no rule checks for `as any`. Without this the audit
// finding "24 bypasses" could come back silently.
//
// The scan runs on two surfaces, never on raw text. `as any` is a type escape
// only in CODE: a comment that says "treat it as any other row" is prose, and a
// string literal that contains "as any" is data — a raw regex flags both, and a
// guard that fails on prose is a guard someone deletes. A @ts-* directive is the
// mirror image: it lives in a comment, so it is matched against comments only (a
// string that spells "@ts-ignore" disables nothing). Both surfaces keep every
// offset, so a match still points at the line it came from.

// Repo root via vitest's cwd — the convention build.test.ts and the bundle
// size check use. This test walks the production tree and reads the program
// file it guards.
const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const files = walk(SRC);
const read = (p: string) => readFileSync(p, "utf-8");
const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

// No alias reaches test/js (package.json imports, the build aliases and
// vitest.config.mjs all stop at foliplus/js and script/), so read the program
// file through the one const this test needs anyway.
const prodTsconfig = read(resolve(REPO_ROOT, "tsconfig.json"));
const testTsconfig = read(resolve(REPO_ROOT, "test/js/tsconfig.json"));

// tsconfig.json is JSON with comments (tsconfig's own dialect), which JSON.parse
// rejects. Strip line comments before parsing — the file carries no // inside
// a string value, so a per-line strip is exact here.
const stripJsonComments = (text: string): string =>
  text
    .split("\n")
    .map(line => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

// ── Source surfaces ──────────────────────────────────────────────────────
// A literal body is masked as a whole. In a template literal only the text
// (head/middle/tail) is literal: the ${…} interpolations stay code, so a cast
// written inside one is still a cast.
const LITERAL_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

type Surface = "code" | "comments";

/** Character mask of every string/template/regex literal body. */
const literalMask = (source: string): Uint8Array => {
  const masked = new Uint8Array(source.length);
  const file = ts.createSourceFile("guard.ts", source, ts.ScriptTarget.Latest, false);
  const visit = (node: ts.Node): void => {
    if (LITERAL_KINDS.has(node.kind)) {
      for (let i = node.getStart(file); i < node.getEnd(); i += 1) {
        masked[i] = 1;
      }
    }
    node.forEachChild(visit);
  };
  visit(file);
  return masked;
};

const pushBlanked = (out: string[], text: string): void => {
  for (const char of text) out.push(char === "\n" ? "\n" : " ");
};

/** The two surfaces a banned pattern can live on, both offset-preserving. */
const sourceViews = (source: string): Record<Surface, string> => {
  const masked = literalMask(source);
  const code: string[] = [];
  const comments: string[] = [];
  let i = 0;
  while (i < source.length) {
    if (masked[i]) {
      // Literal body: neither code nor a comment.
      code.push(source[i] === "\n" ? "\n" : " ");
      comments.push(source[i] === "\n" ? "\n" : " ");
      i += 1;
      continue;
    }
    const pair = source.slice(i, i + 2);
    if (pair === "//") {
      const start = i;
      while (i < source.length && source[i] !== "\n") i += 1;
      const text = source.slice(start, i);
      pushBlanked(code, text);
      comments.push(text);
      continue;
    }
    if (pair === "/*") {
      const close = source.indexOf("*/", i + 2);
      const stop = close < 0 ? source.length : close + 2;
      const text = source.slice(i, stop);
      pushBlanked(code, text);
      comments.push(text);
      i = stop;
      continue;
    }
    code.push(source[i]);
    comments.push(source[i] === "\n" ? "\n" : " ");
    i += 1;
  }
  return { code: code.join(""), comments: comments.join("") };
};

/** One parse per file, shared by every pattern below. */
const viewCache = new Map<string, Record<Surface, string>>();

/** Files whose AST has been built. This is the guard's cost: the raw prefilter
 *  exists to keep it near the narrow-cast allowlist, not the tree size. A
 *  prefilter that accidentally returns true restores the whole-tree parse (the
 *  20 s test #1421 fixed) while every assertion still passes, so the parses are
 *  counted and pinned below. */
let parsedFiles = 0;

const viewsOf = (file: string): Record<Surface, string> => {
  let views = viewCache.get(file);
  if (!views) {
    parsedFiles += 1;
    views = sourceViews(read(file));
    viewCache.set(file, views);
  }
  return views;
};

/** Raw source per file, so the cheap prefilter runs before any parse. */
const rawCache = new Map<string, string>();
const rawOf = (file: string): string => {
  let raw = rawCache.get(file);
  if (raw === undefined) {
    raw = read(file);
    rawCache.set(file, raw);
  }
  return raw;
};

/** Whitespace as the regex `\s` sees it, so the prefilter cannot miss a
 *  `\s+` match the masked surface would make. */
const isWhitespace = (char: string): boolean => /\s/.test(char);

/** Skip whitespace and comments; returns the index of the next code char. */
const skipTrivia = (source: string, from: number): number => {
  let i = from;
  while (i < source.length) {
    const ch = source[i];
    if (isWhitespace(ch)) {
      i += 1;
    } else if (ch === "/" && source[i + 1] === "/") {
      const newline = source.indexOf("\n", i + 2);
      i = newline < 0 ? source.length : newline + 1;
    } else if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? source.length : close + 2;
    } else {
      break;
    }
  }
  return i;
};

/** Word char for the prefilter. `$` is included here, while the judgment
 *  regexes use `\b` (where `$` does NOT end a word). The one disagreement is
 *  `y as any$Foo`: the masked code surface matches `\bas\s+any\b` there, but
 *  that is a type named `any$Foo`, not an `as any` escape, so the prefilter
 *  rejecting it is deliberate — a real escape cannot bind a `$`-prefixed
 *  identifier directly after `any`. Pinned by the "$ adjacency" test below. */
const isWordChar = (char: string | undefined): boolean =>
  char !== undefined && /[A-Za-z0-9_$]/.test(char);

const isWordAt = (source: string, at: number, word: string): boolean =>
  source.startsWith(word, at) &&
  !isWordChar(source[at - 1]) &&
  !isWordChar(source[at + word.length]);

/** Raw-text prefilter: the words separated only by whitespace/comments. A type
 *  assertion cannot put a literal between its 'as' and the type, so this sees
 *  every match the masked code surface can hold — a file it rejects needs no
 *  parse at all. */
const hasTokenSequence = (
  source: string,
  first: RegExp,
  rest: readonly string[],
): boolean => {
  for (const match of source.matchAll(first)) {
    let at = match.index + match[0].length;
    let ok = true;
    for (const word of rest) {
      at = skipTrivia(source, at);
      if (!isWordAt(source, at, word)) {
        ok = false;
        break;
      }
      at += word.length;
    }
    if (ok) return true;
  }
  return false;
};

/** Match one pattern on its surface behind its raw prefilter. The prefilter is
 *  a superset of the surface match, so a hit it rejects is zero either way and
 *  the count is unchanged. */
const matchesIn = (
  file: string,
  re: RegExp,
  surface: Surface,
  prefilter: (source: string) => boolean,
): number => {
  const raw = rawOf(file);
  if (!prefilter(raw)) return 0;
  return (viewsOf(file)[surface].match(re) || []).length;
};

// `\bas\s+any\b` also matches `as any[]`, because `any` is followed by a
// non-word character (`[`) and the boundary holds. That is intended: widening
// to `any[]` is still a type escape, not a false positive. A legitimate
// `as any[]` therefore cannot be exempted by loosening this pattern — an
// exception belongs in an explicit allowance (the mechanism NARROW_CASTS
// provides for the double assertions), so the next reader can see and count it.
type BannedPattern = {
  name: string;
  re: RegExp;
  surface: Surface;
  /** Raw-text necessary condition, run before the AST mask. */
  prefilter: (source: string) => boolean;
};

const BANNED: BannedPattern[] = [
  {
    name: "`as any`",
    re: /\bas\s+any\b/g,
    surface: "code",
    prefilter: source => hasTokenSequence(source, /\bas\b/g, ["any"]),
  },
  {
    name: "`@ts-ignore`",
    re: /@ts-ignore/g,
    surface: "comments",
    prefilter: source => source.includes("@ts-ignore"),
  },
  {
    name: "`@ts-expect-error`",
    re: /@ts-expect-error/g,
    surface: "comments",
    prefilter: source => source.includes("@ts-expect-error"),
  },
  {
    name: "`@ts-nocheck`",
    re: /@ts-nocheck/g,
    surface: "comments",
    prefilter: source => source.includes("@ts-nocheck"),
  },
];

// Unlike `as any`, a double assertion is not always wrong: narrowing down to a
// Leaflet internal field or seeding a deliberately incomplete namespace is the
// idiomatic escape hatch, and the call sites say so in a comment. Hold the
// count flat rather than banning it — the bar is "no new ones", which still
// catches a future `as unknown as any`-style laundering. The table is
// two-way: an entry may not be exceeded, and it must still have a cast left
// (the stale-allowance test below owns the second direction).
const NARROW_CASTS = [
  { f: "core/mapApi.ts", n: 1 },
  { f: "control/ExportControl/index.ts", n: 1 },
  // Tolerant label-config parse: the object shape and color are checked,
  // field-level coercion is the applier's (`applyStyleLabelState`) — the
  // cast says "reader validates". See `parseLabelConfig`.
  { f: "control/LayerControl/persistence.ts", n: 1 },
] as const;
const NARROW_CAST_RE = /\bas\s+unknown\s+as\b|\bas\s+never\b/g;

/** Raw-text prefilter for the two narrow-cast shapes (same gap rule). */
const hasNarrowCast = (source: string): boolean =>
  hasTokenSequence(source, /\bas\b/g, ["unknown", "as"]) ||
  hasTokenSequence(source, /\bas\b/g, ["never"]);

/** The double assertions the production tree actually holds, by repo path. */
const narrowCastHits = (): Map<string, number> =>
  new Map(
    files
      .map(f => ({
        f: rel(f),
        n: matchesIn(f, NARROW_CAST_RE, "code", hasNarrowCast),
      }))
      .filter(x => x.n > 0)
      .map(({ f, n }) => [f, n]),
  );

/** Allowance entries with no cast left — the direction found ⊆ allowed cannot
 *  see. A stale entry widens the budget for a site that no longer needs it. */
const staleAllowances = (
  allowed: ReadonlyArray<{ f: string; n: number }>,
  found: Map<string, number>,
): string[] => allowed.map(({ f }) => `foliplus/js/${f}`).filter(f => !found.has(f));

describe("production type-system bypasses", () => {
  it("scans a non-trivial production tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  for (const { name, re, surface, prefilter } of BANNED) {
    it(`contains no ${name}`, () => {
      const hits = files
        .map(f => ({ f, n: matchesIn(f, re, surface, prefilter) }))
        .filter(x => x.n > 0);
      expect(hits, hits.map(h => `${rel(h.f)}: ${h.n}`).join("\n")).toEqual([]);
    });
  }

  it("keeps double assertions to the known narrow-cast sites", () => {
    // Each entry is the number of double assertions that site is allowed to
    // hold. A new one anywhere in the tree fails this.
    const allowed = new Map(NARROW_CASTS.map(({ f, n }) => [`foliplus/js/${f}`, n]));
    const found = narrowCastHits();
    const problems: string[] = [];
    for (const [f, n] of found) {
      if (!allowed.has(f)) problems.push(`${f}: ${n} (no allowance)`);
      else if (n > allowed.get(f)!) problems.push(`${f}: ${n} > ${allowed.get(f)}`);
    }
    expect(problems).toEqual([]);
  });

  it("leaves no stale narrow-cast allowance", () => {
    // The other direction: an entry must still describe a cast that exists.
    // Without it, a refactor that removes a cast leaves its allowance behind
    // and the one-way check above cannot see the slack — the next cast added
    // at that path would be silently free.
    const stale = staleAllowances(NARROW_CASTS, narrowCastHits());
    expect(
      stale,
      `stale narrow-cast allowances (no cast left — delete the entry): ${stale.join(", ")}`,
    ).toEqual([]);
  });

  // CONFIG ↔ Python parity moved to test/python/test__config_schema.py — the
  // JS side of that check was driving a Python subprocess per CI run, which
  // is what the build itself was pulling Python in for. Same assertions,
  // now in pytest where foliplus is already importable.

  it("test/js/tsconfig.json extends the production program", () => {
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.extends).toBe("../../tsconfig.json");
  });

  it("test/js/tsconfig.json does not relax strictness", () => {
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.compilerOptions.strict).not.toBe(false);
  });

  for (const [label, raw] of [
    ["tsconfig.json", prodTsconfig],
    ["test/js/tsconfig.json", testTsconfig],
  ] as const) {
    it(`${label} pins the ambient declaration instead of globbing *.d.ts`, () => {
      // Every global in foliplus/js/type/global.d.ts (`map`, `CONFIG`, `L`,
      // `MapFoliplus`) is reachable only because the file is listed in `include`.
      // Nothing imports it, so a glob that stops matching silently drops every
      // global at once. Listing it explicitly is a review gate: adding a new
      // ambient declaration must be a deliberate edit.
      const cfg = JSON.parse(stripJsonComments(raw));
      const dts = (cfg.include as string[]).filter(g => g.endsWith(".d.ts"));
      // Exactly one, and named rather than globbed — a `**/*.d.ts` pattern is
      // what originally let this drift.
      expect(dts).toHaveLength(1);
      expect(dts[0].endsWith("foliplus/js/type/global.d.ts")).toBe(true);
    });
  }
});

// Teeth: the surface split is what makes the two checks agree with their
// subjects. Each case is a real shape — prose in a comment, data in a string,
// code in a template interpolation — and a regression to raw-text scanning
// turns the false-positive cases red while the escape cases stay green.
const AS_ANY = /\bas\s+any\b/g;
const TS_DIRECTIVE = /@ts-(?:ignore|expect-error|nocheck)/g;
const countOn = (source: string, re: RegExp, surface: Surface = "code"): number =>
  (sourceViews(source)[surface].match(re) || []).length;

describe("bypass scan teeth", () => {
  it("finds a real `as any` escape", () => {
    expect(countOn("const x = y as any;", AS_ANY)).toBe(1);
  });

  it("ignores `as any` in line and block comments", () => {
    expect(countOn("// treat it as any other row\nconst x = y;", AS_ANY)).toBe(0);
    expect(countOn("/* as any other row */\nconst x = y;", AS_ANY)).toBe(0);
  });

  it("ignores `as any` in strings, regexes and plain templates", () => {
    expect(countOn('const s = "as any";', AS_ANY)).toBe(0);
    expect(countOn("const s = 'as any';", AS_ANY)).toBe(0);
    expect(countOn("const re = /as any/;", AS_ANY)).toBe(0);
    expect(countOn("const t = `as any`;", AS_ANY)).toBe(0);
  });

  it("keeps the code inside a template interpolation", () => {
    expect(countOn("const t = `before ${y as any} after`;", AS_ANY)).toBe(1);
  });

  it("does not let a comment between the tokens hide a cast", () => {
    expect(countOn("const x = y as /* nothing */ any;", AS_ANY)).toBe(1);
  });

  it("matches @ts-* directives in comments only", () => {
    expect(countOn("// @ts-ignore\nconst x = y;", TS_DIRECTIVE, "comments")).toBe(1);
    expect(countOn("/* @ts-nocheck */", TS_DIRECTIVE, "comments")).toBe(1);
    expect(countOn('const s = "@ts-ignore";', TS_DIRECTIVE, "comments")).toBe(0);
    expect(countOn("const re = /@ts-ignore/;", TS_DIRECTIVE, "comments")).toBe(0);
  });

  it("ignores a narrow cast described in a comment", () => {
    expect(
      countOn("// narrow it as unknown as Row\nconst x = y;", NARROW_CAST_RE),
    ).toBe(0);
    expect(countOn("const x = y as unknown as Row;", NARROW_CAST_RE)).toBe(1);
    // A real cast with a trailing comment stays one hit. The second case repeats
    // the pattern inside the comment, so code that leaked comment text into the
    // code surface reports two, and a surface swap reports zero.
    expect(countOn("const x = y as unknown as Row; // narrow ok", NARROW_CAST_RE)).toBe(
      1,
    );
    expect(countOn("const x = y as unknown as Row; // as never", NARROW_CAST_RE)).toBe(
      1,
    );
  });

  it("never lets the raw prefilter hide a real match", () => {
    // The prefilter is a superset: every synthetic source whose masked surface
    // holds a banned pattern must also pass the cheap check that decides
    // whether the file gets parsed at all.
    const samples = [
      "const x = y as any;",
      "const x = y as /* comment */ any;",
      "const x = y\n  as\n  any;",
      "// @ts-ignore\nconst x = y;",
      "/* @ts-expect-error */\nconst x = y;",
      "// @ts-nocheck\n",
      "const x = y as unknown as Row;",
      "const x = y as never;",
    ];
    for (const source of samples) {
      const views = sourceViews(source);
      for (const { re, surface, prefilter } of BANNED) {
        const hits = (views[surface].match(re) || []).length;
        if (hits > 0) expect(prefilter(source), source).toBe(true);
      }
      if ((views.code.match(NARROW_CAST_RE) || []).length > 0) {
        expect(hasNarrowCast(source), source).toBe(true);
      }
    }
  });

  it("parses only the files that can hold a banned pattern", () => {
    // Regression pin for the cheap prefilter itself: run every pattern over the
    // real tree with cold caches and count the ASTs that had to be built. The
    // narrow-cast allowlist is three files; a prefilter that always returns
    // true silently restores 316 parses (and the 20 s timeout) without failing
    // any content assertion, so the budget is asserted here instead of timed.
    viewCache.clear();
    rawCache.clear();
    parsedFiles = 0;
    for (const { re, surface, prefilter } of BANNED) {
      for (const f of files) matchesIn(f, re, surface, prefilter);
    }
    narrowCastHits();
    expect(
      parsedFiles,
      `parsed ${parsedFiles}/${files.length} files — the prefilter is not filtering`,
    ).toBeLessThanOrEqual(10);
  });

  it("documents the deliberate $ adjacency gap", () => {
    // The prefilter treats `$` as a word char; the judgment regexes use `\b`,
    // where `$` is a non-word char. `y as any$Foo` therefore matches the raw
    // regex but is not an `as any` escape (the type is `any$Foo`). The prefilter
    // rejects it on purpose; this pins the difference so a future `\b`-based
    // rewrite does not silently start parsing every file to chase it.
    const source = "const x = y as any$Foo;";
    expect((sourceViews(source).code.match(/\bas\s+any\b/g) || []).length).toBe(1);
    expect(hasTokenSequence(source, /\bas\b/g, ["any"])).toBe(false);
  });

  it("flags a stale allowance, never a live one", () => {
    const live = new Map([["foliplus/js/core/mapApi.ts", 1]]);
    expect(staleAllowances([{ f: "core/mapApi.ts", n: 1 }], live)).toEqual([]);
    expect(
      staleAllowances(
        [
          { f: "core/mapApi.ts", n: 1 },
          { f: "control/LayerControl/ui/style/iconColor.ts", n: 1 },
        ],
        live,
      ),
    ).toEqual(["foliplus/js/control/LayerControl/ui/style/iconColor.ts"]);
  });
});
