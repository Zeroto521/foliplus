import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Guards on the build toolchain: how the scripts expose themselves, how the
// `#script/*` alias is declared, how the lint config claims them, and that
// test/js/script/ holds one test file per real module. None of these test a
// module in script/, so none of them live in test/js/script/: that directory
// stays a strict one-test-file-per-module mapping, and this file — named for
// what it guards, not for a module — owes no entry to the naming rule it enforces.
//
// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const lintConfig = readFileSync(resolve(ROOT, "eslint.config.js"), "utf8");
const vitestConfig = readFileSync(resolve(ROOT, "vitest.config.mjs"), "utf8");
const testTsconfig = readFileSync(resolve(ROOT, "test/js/tsconfig.json"), "utf8");

const scriptModules = () =>
  globSync({
    cwd: ROOT,
    patterns: ["script/**/*.{js,cjs,mjs}"],
    ignore: ["node_modules/**", "script/sonda/**"],
  }).sort();

/** Every `files: [...]` list in the lint config, in document order. */
const fileGlobs = (): string[][] =>
  [...lintConfig.matchAll(/files:\s*\[([^\]]*)\]/g)].map(m =>
    [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]),
  );

const at = (n: number): string[] => {
  const lists = fileGlobs();
  expect(lists.length, `files: occurrence ${n + 1} not found`).toBeGreaterThan(n);
  return lists[n];
};

describe("script module surface", () => {
  it("uses one aggregate block, never an inline export", () => {
    for (const rel of scriptModules()) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      const decls = src.match(/^export\s+/gm) ?? [];

      expect(
        decls.length,
        `${rel}: split export surface — one aggregate block only`,
      ).toBeLessThanOrEqual(1);
      expect(
        src,
        `${rel}: inline export — use one export { … } block at the bottom`,
      ).not.toMatch(/^export\s+(?:const|let|var|function|class|default)\s/m);
    }
  });

  it("does not mix the two styles inside one module", () => {
    for (const rel of scriptModules()) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      const inline = /^export\s+(?:const|let|var|function|class)\s/m.test(src);
      const aggregate = /^export\s*\{/m.test(src);

      expect(
        inline && aggregate,
        `${rel}: mixes inline exports with an aggregate block`,
      ).toBe(false);
    }
  });
});

// The `#script/*` import alias is declared in three independent places.
// Dropping one of them breaks with a bare ERR_PACKAGE_IMPORT_NOT_DEFINED and no
// hint about which declaration drifted, so the trio is asserted together.
describe("#script/* import alias", () => {
  it("package.json imports points #script/* at ./script/*", () => {
    expect(pkg.imports["#script/*"]).toBe("./script/*");
  });

  it("vitest resolve.alias maps #script to the same directory", () => {
    expect(vitestConfig).toMatch(/"#script":\s*resolve\("script"\)/);
  });

  it("test/js tsconfig keeps the #script/* mapping live", () => {
    expect(testTsconfig).toMatch(/"#script\/\*"\s*:\s*\[\s*"\.\.\/\.\.\/script\/\*"/);
  });

  it("the mapped directory exists on disk", () => {
    expect(existsSync(resolve(ROOT, "script"))).toBe(true);
  });
});

// eslint.config.js is its own dead-config risk: a typo in one of its globs
// silently un-exempts half the tree, and nothing in the output mentions it.
describe("eslint.config.js rule scoping", () => {
  it("the module-surface block reaches both foliplus/js and script", () => {
    const blocks = fileGlobs();
    const last = at(blocks.length - 1);
    expect(last).toEqual(
      expect.arrayContaining(["foliplus/js/**/*.ts", "script/**/*.{js,cjs,mjs}"]),
    );
  });

  it("the base-quality block still claims every script extension", () => {
    const first = at(0);
    for (const ext of ["mjs", "cjs", "js"]) {
      expect(first, ext).toContain(`script/**/*.${ext}`);
    }
  });

  it("every script module is claimed by a linted extension", () => {
    const first = at(0);
    for (const rel of scriptModules()) {
      const match = /script\/.*\.(mjs|cjs|js)$/.exec(rel);
      expect(
        match && first.includes(`script/**/*.${match[1]}`),
        `${rel}: not claimed by the base-quality block`,
      ).toBe(true);
    }
  });

  it("require() is exempted only for the test scripts", () => {
    // The exemption is a single scope containing nothing else: if it ever
    // absorbed script/ or foliplus/js, require() would be banned in the
    // build tooling or silently allowed in runtime code.
    const scopes = fileGlobs().map(scope => scope.join(","));
    expect(scopes).toContain("test/js/**/*.{js,ts}");
    const n = scopes.indexOf("test/js/**/*.{js,ts}");
    expect(at(n)).toEqual(["test/js/**/*.{js,ts}"]);
  });
});

// `test/js/script/X.test.ts` tests `script/X.{js,cjs,mjs}`. These two stems have
// no such module: they point at repo-root files that are not in script/. One
// entry per exception, each naming what the file really tests.
const NON_MODULE_TEST_SUBJECTS: Record<string, string> = {
  Makefile: "the root Makefile",
  "vitest.config": "vitest.config.mjs",
};

// `X.test.ts` has a subject when `X` is a real script module, or a stem that is
// on the list above. Anything else is a fossil: a test file named for something
// that does not exist.
const hasSubject = (stem: string) =>
  ["mjs", "cjs", "js"].some(ext =>
    existsSync(resolve(ROOT, "script", `${stem}.${ext}`)),
  ) || stem in NON_MODULE_TEST_SUBJECTS;

describe("test/js/script naming", () => {
  it("every test file names the module it tests", () => {
    const tests = globSync({
      cwd: ROOT,
      patterns: ["test/js/script/*.test.ts"],
    }).sort();
    expect(tests.length).toBeGreaterThan(0);

    const stemOf = (rel: string) =>
      rel.replace(/^test\/js\/script\//, "").replace(/\.test\.ts$/, "");

    const exceptions = Object.entries(NON_MODULE_TEST_SUBJECTS)
      .map(([k, v]) => `  ${k} — ${v}`)
      .join("\n");

    for (const rel of tests) {
      const stem = stemOf(rel);
      expect(
        hasSubject(stem),
        `${rel}: tests no script/${stem}.{mjs,cjs,js} — rename it after the module, ` +
          `or add an entry saying what it tests.\nKnown exceptions:\n${exceptions}`,
      ).toBe(true);
    }

    // The other way: an entry that names no test file is a stale exception.
    for (const stem of Object.keys(NON_MODULE_TEST_SUBJECTS)) {
      expect(
        tests.some(rel => stemOf(rel) === stem),
        `NON_MODULE_TEST_SUBJECTS.${stem} matches no test/js/script/${stem}.test.ts`,
      ).toBe(true);
    }
  });

  it("still rejects a name that maps to nothing", () => {
    // Counter-proof. Without it the loop above would keep passing after someone
    // relaxed hasSubject into a prefix match or a wildcard exception — the guard
    // would go decorative and no test would notice. All three names are real:
    // namespace-plugin.test.ts tested a script that never existed; exports.test.ts
    // was the same pattern, testing package.json and eslint.config.js rather than
    // any script/exports.mjs; script-module-surface.test.ts sat in test/js/script/
    // named for a convention across script/ instead of a module inside it.
    expect(hasSubject("namespace-plugin")).toBe(false);
    expect(hasSubject("exports")).toBe(false);
    expect(hasSubject("script-module-surface")).toBe(false);
    expect(hasSubject("never-a-module")).toBe(false);
    expect(hasSubject("global-namespace-plugin")).toBe(true);
    expect(hasSubject("Makefile")).toBe(true);
  });
});

// The naming rule above runs one way: every test file must name a real module.
// The other direction — every module must have a test file — was the blind
// spot that left script/glyph.mjs uncovered. A module without a test can never
// be an accident: it is either tested, or named here with the reason it
// cannot be. The list is empty today; keeping it is what makes the gap below
// deliberate instead of silent.
const INTENTIONAL_NO_TEST: Record<string, string> = {};

const scriptStem = (rel: string) =>
  rel.replace(/^script\//, "").replace(/\.(mjs|cjs|js)$/, "");

const scriptTestStems = (): Set<string> =>
  new Set(
    globSync({ cwd: ROOT, patterns: ["test/js/script/*.test.ts"] })
      .sort()
      .map(rel => rel.replace(/^test\/js\/script\//, "").replace(/\.test\.ts$/, "")),
  );

const isCovered = (stem: string) =>
  scriptTestStems().has(stem) || stem in INTENTIONAL_NO_TEST;

// ── Tracked listener registrations in foliplus/js ───────────────────────────
//
// Two banned forms, one mechanism. The pre-`BaseControl.on` design made
// document/window-level and capture registrations inexpressible via the base
// class, which is exactly why so many controls reached for `addEventListener`
// and then had to hand-track the removal in a component-owned field. The
// refactor adds `BaseControl.on` with a shared lifecycle `signal`, so
// `capture: true` and window-level targets are first-class again.
//
// `L.DomEvent.on(` is the older half of the same leak: Leaflet's DOM wrapper
// takes no `signal` and returns no unbind closure, so a caller that uses it
// has to remember `L.DomEvent.off` and nothing fails loudly when they don't.
// Same mechanism, same allow-list shape, so the two are guarded together.
//
// `.onclick =` is deliberately not part of either guard: `onclick = null` is
// the legitimate way to clear a handler, and banning the assignment form would
// buy nothing but noise.
//
// Each allow-list entry pins the exact call count for its file, so a new call
// in the same file still fails. The addEventListener list is intentionally
// large (this is the *downstream* work scoped out of the refactor); it is what
// makes the next migration visible.
type AllowEntry = {
  f: string; // relative to foliplus/js/
  n: number; // exact call count
  reason: string;
};

const BARE_ADD_EVENT_LISTENER: ReadonlyArray<AllowEntry> = [
  {
    f: "BaseControl.ts",
    n: 1,
    reason: "the only sanctioned entry point — `on()` is the sole implementation",
  },
  {
    f: "common/fetch.ts",
    n: 1,
    reason:
      "signal.addEventListener('abort', ...) is AbortSignal composition, not a DOM listener — no control instance in scope",
  },
  {
    f: "common/dom.ts",
    n: 2,
    reason:
      "free-standing input-commit helper; the caller owns teardown, and BaseControl can't be reached from the helper's signature",
  },
  {
    f: "common/panel.ts",
    n: 2,
    reason:
      "bindOutsideCollapse / bindFoldToggle factories return their own unbind closure — that is exactly the `effect` case, but the factory itself has no control instance",
  },
  {
    f: "core/hint.ts",
    n: 1,
    reason:
      "HintManager registers fullscreenchange at document level; the manager owns its own lifecycle, independent of any single control",
  },
  {
    f: "core/interaction.ts",
    n: 2,
    reason:
      "KeyboardManager binds per-element + document listeners on behalf of multiple controls; migration means threading a signal through the manager API",
  },
  {
    f: "core/labelControl.ts",
    n: 1,
    reason:
      "free-standing label widget in core, not yet routed through a BaseControl instance",
  },
  {
    f: "core/listCursor.ts",
    n: 1,
    reason:
      "free-standing list-cursor utility — keydown binding owned by the caller, no control in scope",
  },
  {
    f: "ExportControl/manager.ts",
    n: 1,
    reason: "image preview click-dismiss — pending migration to `this.on`",
  },
  {
    f: "FullscreenControl/logic.ts",
    n: 1,
    reason:
      "fullscreenchange listener at document level — pending migration to `this.on(window/document, ...)`",
  },
  {
    f: "HeatmapControl/ui.ts",
    n: 1,
    reason:
      "scheme-dropdown outside-click — pending migration to `this.on(document, 'click', ..., {capture: true})`",
  },
  {
    f: "MeasureControl/util.ts",
    n: 1,
    reason:
      "SVG animationend listener on an ephemeral path element — pending migration to `this.on`",
  },
  {
    f: "MeasureControl/mode/circle.ts",
    n: 1,
    reason:
      "SVG animationend listener on an ephemeral ripple element — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/attr.ts",
    n: 3,
    reason: "attribute panel event bindings — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/index.ts",
    n: 13,
    reason:
      "layer list / drag / reorder / more-menu bindings — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/menu.ts",
    n: 1,
    reason: "more-menu outside-click — pending migration to `this.on`",
  },
  {
    f: "LayerControl/ui/style.ts",
    n: 5,
    reason:
      "style-panel input / dropdown / opacity bindings — pending migration to `this.on`",
  },
];

// `L.DomEvent.on(` is rare in this tree, which is the point of the guard: one
// file, three calls, all in the same pair of factories. Quantified before the
// entry was written, not after.
const L_DOM_EVENT_ON: ReadonlyArray<AllowEntry> = [
  {
    f: "common/panel.ts",
    n: 3,
    reason:
      "bindPanelToggle (2) and bindFoldToggle (1) are free-standing factories: their signatures take a container/opts object, not a BaseControl instance, so `this.on` is unreachable from inside them. Same class of exception as the addEventListener entry for this same file — migrating means threading a control reference through the factory API",
  },
];

// The addEventListener match needs a `.` prefix so `addEventListener(` at the
// start of a line or behind a paren is still caught, and it does not match
// `removeEventListener(` — after `document.` comes `remove…`, not `addEventListener`.
const BARE_RE = /\.\s*addEventListener\s*\(/g;
// `L.DomEvent.on(` and not `L.DomEvent.once(`: `.once` is Leaflet's
// auto-removing variant, which unbinds itself after the first fire, so it is
// not a leak in the same sense. Zero occurrences in the tree today; the
// counter-proof below pins that it is excluded on purpose.
const DOM_EVENT_ON_RE = /\bL\.DomEvent\.on\s*\(/g;

/**
 * Strip line and block comments from TypeScript source, but skip over
 * string literals (single, double, backtick) and regex literals so that
 * a slash-slash inside a URL or a regex is not misinterpreted as a
 * comment start.
 *
 * This is a character-by-character scanner: it tracks whether the current
 * position is inside a string, template literal, or regex, and only
 * treats slash-slash or block-comment delimiters as comments when we
 * are in "code" mode.
 */
const stripComments = (src: string): string => {
  let out = "";
  let i = 0;
  const n = src.length;
  let prev = "";
  while (i < n) {
    const ch = src[i];
    const next = i + 1 < n ? src[i + 1] : "";
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      out += " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      out += ch;
      i++;
      while (i < n && src[i] !== ch) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      prev = ch;
      continue;
    }
    if (ch === "`") {
      out += ch;
      i++;
      while (i < n && src[i] !== "`") {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "{") {
          out += src[i] + src[i + 1];
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (src[i] === "{") depth++;
            else if (src[i] === "}") depth--;
            if (depth > 0) out += src[i];
            i++;
          }
        } else {
          out += src[i];
          i++;
        }
      }
      if (i < n) {
        out += src[i];
        i++;
      }
      prev = "`";
      continue;
    }
    if (ch === "/" && prev !== "a-zA-Z0-9_$)" && !"].}'.\"`".includes(prev)) {
      out += ch;
      i++;
      while (i < n && src[i] !== "/") {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (src[i] === "\n") {
          out += "/";
          prev = "/";
          break;
        }
        out += src[i];
        i++;
      }
      if (i < n && src[i] === "/") {
        out += src[i];
        i++;
      }
      prev = "/";
      continue;
    }
    out += ch;
    if (ch.trim() !== "") prev = ch;
    i++;
  }
  return out;
};

const callsIn = (src: string, re: RegExp): number =>
  stripComments(src).match(re)?.length ?? 0;

/** Per-file call count measured against the production tree. */
const scan = (re: RegExp): Array<{ f: string; n: number }> => {
  const hits: Array<{ f: string; n: number }> = [];
  const files = globSync({
    cwd: ROOT,
    patterns: ["foliplus/js/**/*.ts"],
  }).sort();
  for (const rel of files) {
    const n = callsIn(readFileSync(resolve(ROOT, rel), "utf8"), re);
    if (n > 0) hits.push({ f: rel.replace(/^foliplus\/js\//, ""), n });
  }
  return hits;
};

/**
 * Compare a measured per-file call count against an allow-list.
 *
 * Pure on purpose: no fs, no regex, no glob. `tree` is what the scan
 * measured, `allow` is the pinned list, and one string per discrepancy comes
 * back. The counter-proofs below assert on synthetic input through this
 * function, so they exercise the same decision the real test does — an
 * earlier draft asserted on a parallel re-implementation of the loop, which
 * kept passing even after the loop itself was gutted.
 */
const checkBareListeners = (
  call: string,
  tree: ReadonlyArray<{ f: string; n: number }>,
  allow: ReadonlyArray<{ f: string; n: number }>,
): string[] => {
  const problems: string[] = [];
  const pinned = new Map<string, number>();
  for (const e of allow) {
    if (pinned.has(e.f)) {
      problems.push(
        `${e.f}: duplicate allow-list entry — first pins n=${pinned.get(e.f)}, ` +
          `this one says n=${e.n}`,
      );
      continue;
    }
    pinned.set(e.f, e.n);
  }

  // `seen` means "the scan reached this file", not "the count matched". A
  // file with a drifted count is reported once as a drift; a file the scan
  // never touched at all is reported once as stale.
  const seen = new Set<string>();
  for (const { f, n } of tree) {
    seen.add(f);
    const expected = pinned.get(f);
    if (expected === undefined) {
      problems.push(
        `${f}: ${n} ${call} call(s) — not on the allow-list; route it ` +
          `through the tracked entry or add an entry with the reason`,
      );
    } else if (n !== expected) {
      problems.push(
        `${f}: ${n} ${call} call(s), allow-list pins ${expected} — a new one ` +
          `crept in, or the file was already migrated (drop the entry)`,
      );
    }
  }

  for (const e of allow) {
    if (!seen.has(e.f)) {
      problems.push(
        `${e.f}: allow-list entry (n=${e.n}) but the scan found no ${call} ` +
          `call — the entry is stale, remove it`,
      );
    }
  }
  return problems;
};

describe("no bare addEventListener in foliplus/js", () => {
  it("every bare call is on the allow-list, and the allow-list still matches the tree", () => {
    expect(
      checkBareListeners(
        "bare addEventListener",
        scan(BARE_RE),
        BARE_ADD_EVENT_LISTENER,
      ),
    ).toEqual([]);
  });

  it("BaseControl.ts is actually the sole addEventListener implementation", () => {
    // Counter-proof. Without this the allow-list's BaseControl entry would
    // let the guard pass vacuously after someone moved the entry point out
    // (e.g. inlined it into each component) — the whole point of the guard
    // would collapse silently.
    const src = readFileSync(resolve(ROOT, "foliplus/js/BaseControl.ts"), "utf8");
    expect(stripComments(src)).toMatch(/target\.addEventListener\(/);
    expect(stripComments(src)).toMatch(/signal/);
  });
});

describe("no L.DomEvent.on in foliplus/js", () => {
  it("every L.DomEvent.on call is on the allow-list, and the allow-list still matches the tree", () => {
    expect(
      checkBareListeners("L.DomEvent.on", scan(DOM_EVENT_ON_RE), L_DOM_EVENT_ON),
    ).toEqual([]);
  });
});

describe("the listener allow-list guard still bites", () => {
  // Counter-proof. Without these the two scans above would keep passing after
  // the regex stopped matching anything, after the allow-list became a free
  // pass for every file, or after the checker itself went decorative. They
  // feed checkBareListeners synthetic input — not a copy of the scan — so a
  // regression in the decision logic is what they catch.
  it("flags a call no allow-list entry pins", () => {
    const problems = checkBareListeners(
      "bare addEventListener",
      [{ f: "NewControl/ui.ts", n: 1 }],
      BARE_ADD_EVENT_LISTENER,
    );
    expect(problems.filter(p => p.startsWith("NewControl/ui.ts:"))).toEqual([
      "NewControl/ui.ts: 1 bare addEventListener call(s) — not on the " +
        "allow-list; route it through the tracked entry or add an entry with the reason",
    ]);
  });

  it("flags a count drift on a pinned file", () => {
    const problems = checkBareListeners(
      "bare addEventListener",
      [{ f: "BaseControl.ts", n: 2 }],
      BARE_ADD_EVENT_LISTENER,
    );
    expect(problems.filter(p => p.startsWith("BaseControl.ts:"))).toEqual([
      "BaseControl.ts: 2 bare addEventListener call(s), allow-list pins 1 " +
        "— a new one crept in, or the file was already migrated (drop the entry)",
    ]);
  });

  it("flags a stale entry for a file that is fully migrated", () => {
    const problems = checkBareListeners(
      "bare addEventListener",
      [],
      [{ f: "GoneControl/ui.ts", n: 3 }],
    );
    expect(problems).toEqual([
      "GoneControl/ui.ts: allow-list entry (n=3) but the scan found no " +
        "bare addEventListener call — the entry is stale, remove it",
    ]);
  });

  it("flags a duplicate allow-list entry instead of silently overwriting it", () => {
    // A duplicate key used to be a Map overwrite: "duplicate + wrong count"
    // passed undetected, and the surviving entry was whichever came last.
    const problems = checkBareListeners(
      "L.DomEvent.on",
      [{ f: "common/panel.ts", n: 3 }],
      [
        { f: "common/panel.ts", n: 3 },
        { f: "common/panel.ts", n: 1 },
      ],
    );
    expect(problems).toEqual([
      "common/panel.ts: duplicate allow-list entry — first pins n=3, this one says n=1",
    ]);
  });

  it("both real allow-lists are free of duplicate keys", () => {
    for (const [label, list] of [
      ["BARE_ADD_EVENT_LISTENER", BARE_ADD_EVENT_LISTENER],
      ["L_DOM_EVENT_ON", L_DOM_EVENT_ON],
    ] as const) {
      const files = list.map(e => e.f);
      expect(new Set(files).size, label).toBe(files.length);
    }
  });

  it("the regexes match what they claim and nothing else", () => {
    expect(callsIn("target.addEventListener('click', fn)", BARE_RE)).toBe(1);
    expect(callsIn("target.addEventListener ('click', fn)", BARE_RE)).toBe(1);
    expect(callsIn("// fake.addEventListener('click')", BARE_RE)).toBe(0);
    expect(callsIn("/* x */ target.addEventListener('click', fn)", BARE_RE)).toBe(1);
    // `removeEventListener(` is not a registration.
    expect(callsIn("target.removeEventListener('click', fn)", BARE_RE)).toBe(0);
    // String-aware: `//` inside a URL is not a comment start.
    expect(
      callsIn('const u = "https://x"; target.addEventListener("click", fn)', BARE_RE),
    ).toBe(1);
    // `//` inside a regex literal is not a comment start.
    expect(
      callsIn('/\\/\\/x/.test(s); target.addEventListener("click", fn)', BARE_RE),
    ).toBe(1);

    expect(callsIn('L.DomEvent.on(btn, "click", fn)', DOM_EVENT_ON_RE)).toBe(1);
    expect(callsIn("L.DomEvent.on (btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(1);
    expect(callsIn("// L.DomEvent.on(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);
    // The rest of the Leaflet DOM surface is not a registration.
    expect(callsIn("L.DomEvent.off(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);
    expect(callsIn("L.DomEvent.stop(event)", DOM_EVENT_ON_RE)).toBe(0);
    expect(callsIn("L.DomEvent.disableClickPropagation(el)", DOM_EVENT_ON_RE)).toBe(0);
    // `.once` is the auto-removing variant, excluded on purpose.
    expect(callsIn("L.DomEvent.once(btn, 'click', fn)", DOM_EVENT_ON_RE)).toBe(0);
  });
});

describe("script module coverage", () => {
  it("every script module is tested, or named as deliberately untested", () => {
    const intentional = Object.entries(INTENTIONAL_NO_TEST)
      .map(([k, v]) => `  ${k} — ${v}`)
      .join("\n");

    for (const rel of scriptModules()) {
      const stem = scriptStem(rel);
      expect(
        isCovered(stem),
        `${rel}: no test/js/script/${stem}.test.ts — add one, or name it as ` +
          `deliberately untested with the reason.\nKnown intentional gaps:\n${intentional}`,
      ).toBe(true);
    }
  });

  it("the escape hatch is neither stale nor decorative", () => {
    // An entry that no longer applies is dead config: it trains a reader to
    // trust the list, so a later real gap gets the same treatment for free.
    for (const stem of Object.keys(INTENTIONAL_NO_TEST)) {
      expect(
        scriptModules().some(rel => scriptStem(rel) === stem),
        `INTENTIONAL_NO_TEST.${stem} matches no script module`,
      ).toBe(true);
      expect(
        scriptTestStems().has(stem),
        `INTENTIONAL_NO_TEST.${stem} has a test file — drop the entry`,
      ).toBe(false);
    }

    // Counter-proof. Without it the loop above would keep passing after the
    // escape hatch stopped being a list and started matching everything — the
    // guard would go decorative and no test would notice.
    expect(isCovered("glyph")).toBe(true);
    expect(isCovered("never-a-module")).toBe(false);
  });
});
