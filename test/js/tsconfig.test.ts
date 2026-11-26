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
const viewsOf = (file: string): Record<Surface, string> => {
  let views = viewCache.get(file);
  if (!views) {
    views = sourceViews(read(file));
    viewCache.set(file, views);
  }
  return views;
};

// `\bas\s+any\b` also matches `as any[]`, because `any` is followed by a
// non-word character (`[`) and the boundary holds. That is intended: widening
// to `any[]` is still a type escape, not a false positive. A legitimate
// `as any[]` therefore cannot be exempted by loosening this pattern — an
// exception belongs in an explicit allowance (the mechanism NARROW_CASTS
// provides for the double assertions), so the next reader can see and count it.
const BANNED: Array<{ name: string; re: RegExp; surface: Surface }> = [
  { name: "`as any`", re: /\bas\s+any\b/g, surface: "code" },
  { name: "`@ts-ignore`", re: /@ts-ignore/g, surface: "comments" },
  { name: "`@ts-expect-error`", re: /@ts-expect-error/g, surface: "comments" },
  { name: "`@ts-nocheck`", re: /@ts-nocheck/g, surface: "comments" },
];

// Unlike `as any`, a double assertion is not always wrong: narrowing down to a
// Leaflet internal field or seeding a deliberately incomplete namespace is the
// idiomatic escape hatch, and the call sites say so in a comment. Hold the
// count flat rather than banning it — the bar is "no new ones", which still
// catches a future `as unknown as any`-style laundering.
const NARROW_CASTS = [
  { f: "core/mapApi.ts", n: 1 },
  { f: "control/ExportControl/index.ts", n: 1 },
  // Tolerant label-config parse: the object shape and color are checked,
  // field-level coercion is the applier's (`applyStyleLabelState`) — the
  // cast says "reader validates". See `parseLabelConfig`.
  { f: "control/LayerControl/persistence.ts", n: 1 },
  // The marker-color row factory: buildIconColorRow returns HTMLElement | null
  // (the capability gate), so the dimension registry's row slot narrows with a
  // cast — the same shape every other style row uses.
  { f: "control/LayerControl/ui/style/iconColor.ts", n: 1 },
  // The marker chassis row factory: buildMarkerColorRow returns
  // HTMLElement | null (the capability gate), so the dimension registry's
  // row slot narrows with a cast — the same shape every other style row uses.
  { f: "control/LayerControl/ui/style/markerColor.ts", n: 1 },
] as const;
const NARROW_CAST_RE = /\bas\s+unknown\s+as\b|\bas\s+never\b/g;

describe("production type-system bypasses", () => {
  it("scans a non-trivial production tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  for (const { name, re, surface } of BANNED) {
    it(`contains no ${name}`, () => {
      const hits = files
        .map(f => ({ f, n: (viewsOf(f)[surface].match(re) || []).length }))
        .filter(x => x.n > 0);
      expect(hits, hits.map(h => `${rel(h.f)}: ${h.n}`).join("\n")).toEqual([]);
    });
  }

  it("keeps double assertions to the known narrow-cast sites", () => {
    const hits = files
      .map(f => ({
        f: rel(f),
        n: (viewsOf(f).code.match(NARROW_CAST_RE) || []).length,
      }))
      .filter(x => x.n > 0);
    // Each entry is the number of double assertions that site is allowed to
    // hold. A new one anywhere in the tree fails this.
    const allowed = new Map(NARROW_CASTS.map(({ f, n }) => [`foliplus/js/${f}`, n]));
    const found = new Map(hits.map(({ f, n }) => [f, n]));
    const problems: string[] = [];
    for (const [f, n] of found) {
      if (!allowed.has(f)) problems.push(`${f}: ${n} (no allowance)`);
      else if (n > allowed.get(f)!) problems.push(`${f}: ${n} > ${allowed.get(f)}`);
    }
    expect(problems).toEqual([]);
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
});
