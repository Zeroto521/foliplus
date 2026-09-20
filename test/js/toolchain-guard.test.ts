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

// ── No bare addEventListener in foliplus/js ─────────────────────────────────
//
// The pre-`BaseControl.on` design made document/window-level and capture
// registrations inexpressible via the base class, which is exactly why so many
// controls reached for `addEventListener` and then had to hand-track the
// removal in a component-owned field. The refactor adds `BaseControl.on` with
// a shared lifecycle `signal`, so `capture: true` and window-level targets
// are first-class again. This guard stops new bare calls from creeping in.
//
// The allow-list records the current bare calls with the reason each cannot be
// migrated yet — either the call is inside `BaseControl.on` itself (the sole
// entry), it's a factory in `common/`/`core/` that cannot reach a control
// instance, or the file is another PR's territory (T28 = LayerControl/ui/**).
// Each entry pins the exact call count, so a new bare call in the same file
// still fails. The list is intentionally large (this is the *downstream* work
// the user scoped out); it is what makes the next migration visible.
const BARE_ADD_EVENT_LISTENER: ReadonlyArray<{
  f: string; // relative to foliplus/js/
  n: number; // exact bare addEventListener call count
  reason: string;
}> = [
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
    reason:
      "T28 in-flight — LayerControl/ui/** is another PR's scope; this guard names them so the count is pinned, not swept",
  },
  {
    f: "LayerControl/ui/index.ts",
    n: 13,
    reason:
      "T28 in-flight — LayerControl/ui/** is another PR's scope; 13 pinned, no more allowed without an explicit change",
  },
  {
    f: "LayerControl/ui/menu.ts",
    n: 1,
    reason: "T28 in-flight — LayerControl/ui/** is another PR's scope",
  },
  {
    f: "LayerControl/ui/style.ts",
    n: 5,
    reason: "T28 in-flight — LayerControl/ui/** is another PR's scope",
  },
];

const BARE_RE = /\.\s*addEventListener\s*\(/g;
const stripComments = (src: string): string =>
  src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, " ");

const bareCallsIn = (src: string): number =>
  stripComments(src).match(BARE_RE)?.length ?? 0;

describe("no bare addEventListener in foliplus/js", () => {
  it("every bare call is on the allow-list, and the allow-list still matches the tree", () => {
    const files = globSync({
      cwd: ROOT,
      patterns: ["foliplus/js/**/*.ts"],
    }).sort();
    const problems: string[] = [];
    const allow = new Map(BARE_ADD_EVENT_LISTENER.map(e => [e.f, e.n]));
    const seen = new Set<string>();

    for (const rel of files) {
      const src = readFileSync(resolve(ROOT, rel), "utf8");
      const n = bareCallsIn(src);
      if (n === 0) continue;
      const key = rel.replace(/^foliplus\/js\//, "");
      const allowed = allow.get(key);
      if (allowed === undefined) {
        problems.push(
          `${key}: ${n} bare addEventListener call(s) — not on the allow-list; ` +
            "migrate to this.on or add an entry with the reason",
        );
      } else if (n !== allowed) {
        problems.push(
          `${key}: ${n} bare call(s), allow-list says ${allowed} — ` +
            `a new one crept in, or the file was already migrated (drop the entry)`,
        );
      } else {
        seen.add(key);
      }
    }

    for (const e of BARE_ADD_EVENT_LISTENER) {
      if (!seen.has(e.f)) {
        problems.push(
          `${e.f}: allow-list entry (n=${e.n}) but the file has no bare calls — ` +
            `the entry is stale, remove it`,
        );
      }
    }

    expect(problems).toEqual([]);
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

  it("the scan and the allow-list both still bite", () => {
    // Counter-proof. Without this the loop above would keep passing after the
    // regex stopped matching anything, or after the allow-list became a free
    // pass for every file — the guard would go decorative and no test would
    // notice. Every expected value here is one that must NOT be true.
    expect(bareCallsIn("target.addEventListener('click', fn)")).toBe(1);
    expect(bareCallsIn("target.addEventListener ('click', fn)")).toBe(1);
    expect(bareCallsIn("// fake.addEventListener('click')")).toBe(0);
    expect(bareCallsIn("/* x */ target.addEventListener('click', fn)")).toBe(1);
    expect(bareCallsIn("target.addEventListener('click', fn)")).not.toBe(0);

    const isAllowed = (f: string, n: number) => {
      const e = BARE_ADD_EVENT_LISTENER.find(x => x.f === f);
      return !!e && e.n === n;
    };
    expect(isAllowed("BaseControl.ts", 1)).toBe(true);
    expect(isAllowed("BaseControl.ts", 2)).toBe(false);
    expect(isAllowed("LayerControl/ui/index.ts", 13)).toBe(true);
    expect(isAllowed("LayerControl/ui/index.ts", 14)).toBe(false);
    expect(isAllowed("never-added.ts", 1)).toBe(false);
    expect(isAllowed("never-added.ts", 0)).toBe(false);
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
