// test/js/guard/test-path-mirror — the test tree mirrors the production
// tree, in both directions.
//
// The rule (commit 3ecb1a494): a test file must name the module it tests, at
// that module's own path — test/js/core/layer/canvasAlpha.test.ts mirrors
// foliplus/js/core/layer/canvasAlpha.ts. A feature name ("declaredBorder") or a
// different tier ("platform/guard" for core/lifecycle/guard) hides the module
// from a reader and leaves the real module untested by name.
//
// Aspect files: a test split by behaviour cluster is named
// "<module>.<aspect>.test.ts" (the test-file size and split rule).
// The aspect is a single lowercase word; the file resolves to "<module>.ts",
// the canonical "<module>.test.ts" must exist, and two aspect files of one
// module may not claim the same word.
//
// Direction 1 (test -> module): every module test under test/js — outside
// test/js/script, which has its own mirror rule in toolchain-guard.test.ts —
// must resolve to foliplus/js/<same stem>.ts (or, for an aspect file, to
// foliplus/js/<module>.ts with a canonical <module>.test.ts), unless named in
// NON_MIRRORED_TEST (or under a NON_MIRRORED_DIR) with the reason it has no
// single module.
//
// Direction 2 (module -> test): every executable module under the shared tiers
// (platform/, ui/, core/) must have a same-named test, unless named in
// INTENTIONAL_NO_TEST. Barrels and declaration-only files (index.ts, type.ts,
// const.ts, *ClassName.ts, *.d.ts) are exempt by kind: they carry no behaviour
// of their own. Component internals (control/) are covered by the integration
// and browser suites rather than same-named unit tests, so that tier is out of
// scope for this direction.
//
// Teeth: problemsFor()/missingTestsFor()/aspectCollisions() are pure over an
// injected tree, and the cases below feed them a misplaced test, a feature-named
// test, a missing tier test, an aspect with no module, an aspect with no
// canonical test and a duplicate aspect word. A relaxation into a prefix match
// or a category wildcard turns the real-tree assertions green while these stay
// red.
import { resolve } from "node:path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");

const TIERS = ["platform", "ui", "core"] as const;

/** Files that declare a shape but hold no behaviour: no same-named test needed. */
const DECLARATION_ONLY = [/^index$/, /^type$/, /^const$/, /ClassName$/, /\.d$/];

/** Tests with no single production module, keyed by stem under test/js/. */
const NON_MIRRORED_TEST: Record<string, string> = {
  bundle: "build-output smoke test (reads foliplus/dist + manifest), not a module test",
  fixture: "tests the shared test fixture helper test/js/fixture.ts",
  "listener-tracking":
    "production-tree listener registration guard (banned forms + allow-list), no single module",
  "toolchain-guard":
    "build/tooling configuration guard (eslint scoping, script coverage), no single module",
  tsconfig: "test TypeScript config guard, no single module",
  "core/layer/layout":
    "aggregate test of the core/layer/layout subpackage (default/merge/persist/project), which has no single module file",
  "core/order/order":
    "aggregate test of the core/order engine (doc/command/resolve/rank/alphabet), which has no single module file",
  "control/LayerControl/label/labelReplay-perf":
    "wall-clock gate for the label replay (control/LayerControl/label/index.ts renderLabels); the -perf suffix marks it a timing gate, not a mirror of a labelReplay-perf module",
};

/** Test directories that are categories, not mirrors (each file still names the
 *  module it exercises). */
const NON_MIRRORED_DIR: Record<string, string> = {
  guard: "repo-wide invariant guards, each names the invariant it checks, not a module",
  perf: "wall-clock gates grouped by measurement category (see perf/collision.test.ts); each file still names the production module it times",
};

/** Executable modules with no same-named test, keyed by stem under foliplus/js/. */
const INTENTIONAL_NO_TEST: Record<string, string> = {
  "core/geo/geodesic":
    "turf geodesic wrapper exercised through MeasureControl's unit and browser suites",
  "core/interaction/interactionManager":
    "per-map interaction registry exercised through BaseControl and the browser suite",
  "core/layer/layout/default":
    "covered by the aggregate test/js/core/layer/layout.test.ts",
  "core/layer/layout/merge":
    "covered by the aggregate test/js/core/layer/layout.test.ts",
  "core/layer/layout/persist":
    "covered by the aggregate test/js/core/layer/layout.test.ts",
  "core/layer/layout/project":
    "covered by the aggregate test/js/core/layer/layout.test.ts",
  "core/order/alphabet":
    "covered by the aggregate test/js/core/order/order.test.ts + rank.test.ts",
  "core/order/command":
    "covered by the aggregate test/js/core/order/order.test.ts",
  "core/order/util":
    "covered by the aggregate test/js/core/order/order.test.ts",

  "core/leaflet/markerColorPreset":
    "preset data table pinned by test/js/script/check/marker-color-preset.test.ts",
  "core/lifecycle/component":
    "component lifecycle helpers exercised through the defineControl / controlEnv suites",
  "ui/scrollIntoView":
    "DOM scroll helper exercised through the dropdown / listbox suites",
};

const posix = (rel: string): string => rel.split("\\").join("/");

/** Stems of every module test under test/js, minus the script tree (which the
 *  toolchain guard mirrors against script/). */
const listTestStems = (): string[] =>
  globSync({ cwd: ROOT, patterns: ["test/js/**/*.test.ts"] })
    .map(posix)
    .filter(rel => !rel.startsWith("test/js/script/"))
    .map(rel => rel.replace(/^test\/js\//, "").replace(/\.test\.ts$/, ""))
    .sort();

/** Stems of every production module under foliplus/js. */
const listModuleStems = (): string[] =>
  globSync({ cwd: ROOT, patterns: ["foliplus/js/**/*.ts"] })
    .map(posix)
    .map(rel => rel.replace(/^foliplus\/js\//, "").replace(/\.ts$/, ""));

const isDeclarationOnly = (stem: string): boolean => {
  const name = stem.split("/").pop() ?? "";
  return DECLARATION_ONLY.some(re => re.test(name));
};

/** Shared-tier modules that must carry a same-named test. */
const listCoveredModuleStems = (modules: string[]): string[] =>
  modules
    .filter(stem => TIERS.some(tier => stem.startsWith(`${tier}/`)))
    .filter(stem => !isDeclarationOnly(stem))
    .sort();

const underNonMirroredDir = (stem: string): boolean =>
  Object.keys(NON_MIRRORED_DIR).some(dir => stem === dir || stem.startsWith(`${dir}/`));

const isNonMirrored = (stem: string): boolean =>
  stem in NON_MIRRORED_TEST || underNonMirroredDir(stem);
/** Split a stem's last segment into [canonical, aspect]. An aspect file is
 *  `<module>.<aspect>` where `<aspect>` is a single lowercase word (the
 *  behaviour cluster the file proves). A stem with no aspect suffix returns
 *  [stem, null]. */
const splitAspect = (stem: string): [string, string | null] => {
  const segments = stem.split("/");
  const last = segments.pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return [stem, null];
  const aspect = last.slice(dot + 1);
  // A single lowercase word only — a dot with an uppercase or multi-word tail
  // is not an aspect (it is a genuinely module-less name the guard reports).
  if (!/^[a-z]+$/.test(aspect)) return [stem, null];
  segments.push(last.slice(0, dot));
  return [segments.join("/"), aspect];
};

/** Aspect stems whose word collides with another aspect of the same module.
 *  The filesystem cannot hold two files at one path, so a real-tree collision
 *  is impossible today; the rule is still pinned here because a future split
 *  tool that renames or moves aspect files must not reuse a word. */
const aspectCollisions = (tests: string[]): string[] => {
  const first = new Map<string, string>();
  const collisions: string[] = [];
  for (const stem of tests) {
    const [canonical, aspect] = splitAspect(stem);
    if (aspect === null) continue;
    const key = `${canonical}.${aspect}`;
    const owner = first.get(key);
    if (owner === undefined) {
      first.set(key, stem);
      continue;
    }
    collisions.push(
      `${stem} (duplicate aspect "${aspect}" of ${canonical}; first claimed by ${owner})`,
    );
  }
  return collisions;
};

/** Direction 1: a test must name a module at the exact mirrored path. */
/** Direction 1: a test must name a module at the exact mirrored path, OR be an
 *  aspect sibling (`<module>.<aspect>`) of a module whose canonical
 *  `<module>.test.ts` exists. */
const problemsFor = (tests: string[], modules: Set<string>): string[] => {
  const testSet = new Set(tests);
  return tests.filter(stem => {
    if (modules.has(stem) || isNonMirrored(stem)) return false;
    const [canonical, aspect] = splitAspect(stem);
    // Not an aspect file: reported as before (module-less name).
    if (aspect === null) return true;
    // Aspect file: legal only when the module and its canonical test exist.
    return !modules.has(canonical) || !testSet.has(canonical);
  });
};

/** Direction 2: a shared-tier module must have a same-named test. */
const missingTestsFor = (modules: string[], tests: Set<string>): string[] =>
  modules.filter(stem => !tests.has(stem) && !(stem in INTENTIONAL_NO_TEST));

describe("test-path mirror", () => {
  const tests = listTestStems();
  const modules = new Set(listModuleStems());

  it("scans a non-trivial tree", () => {
    expect(tests.length).toBeGreaterThanOrEqual(100);
    expect(modules.size).toBeGreaterThanOrEqual(200);
  });

  it("every module test names a module at the mirrored path", () => {
    const problems = problemsFor(tests, modules);
    const exceptions = [
      ...Object.entries(NON_MIRRORED_TEST).map(([k, v]) => `  ${k} — ${v}`),
      ...Object.entries(NON_MIRRORED_DIR).map(([k, v]) => `  ${k}/ — ${v}`),
    ].join("\n");
    expect(
      problems,
      `test files with no mirrored foliplus/js/<stem>.ts — move the file to the module's path, or name it in NON_MIRRORED_TEST with the module-less reason it tests:\n${problems.map(p => `  ${p}: no foliplus/js/${p}.ts`).join("\n")}\nKnown non-module tests:\n${exceptions}`,
    ).toEqual([]);
  });

  it("no two aspect files of one module claim the same word", () => {
    expect(aspectCollisions(tests)).toEqual([]);
  });
  it("every shared-tier module has a same-named test, or a named reason", () => {
    const covered = listCoveredModuleStems([...modules]);
    const testSet = new Set(tests);
    const missing = missingTestsFor(covered, testSet);
    const reasons = Object.entries(INTENTIONAL_NO_TEST)
      .map(([k, v]) => `  ${k} — ${v}`)
      .join("\n");
    expect(
      missing,
      `shared-tier modules with no test/js/<stem>.test.ts — add one at the mirrored path, or name it in INTENTIONAL_NO_TEST with the reason it cannot have a unit test:\n${missing.map(m => `  ${m}: no test/js/${m}.test.ts`).join("\n")}\nKnown intentional gaps:\n${reasons}`,
    ).toEqual([]);
  });

  it("the exception lists are live, not stale", () => {
    for (const stem of Object.keys(NON_MIRRORED_TEST)) {
      expect(
        tests.includes(stem),
        `NON_MIRRORED_TEST.${stem} matches no test/js/${stem}.test.ts — drop the entry`,
      ).toBe(true);
      // An entry is only legitimate while the file has no single module. An
      // aspect file resolves through its canonical module, so an entry that
      // would resolve is stale — the aspect rule replaced it.
      const [canonical, aspect] = splitAspect(stem);
      if (aspect !== null) {
        expect(
          modules.has(canonical) && tests.includes(canonical),
          `NON_MIRRORED_TEST.${stem} is an aspect file of ${canonical} — drop the entry and let the mirror hold`,
        ).toBe(false);
      }
    }
    for (const dir of Object.keys(NON_MIRRORED_DIR)) {
      expect(
        tests.some(stem => underNonMirroredDir(stem) && stem.startsWith(`${dir}/`)),
        `NON_MIRRORED_DIR.${dir} matches no test under test/js/${dir}/`,
      ).toBe(true);
    }
    for (const stem of Object.keys(INTENTIONAL_NO_TEST)) {
      expect(
        modules.has(stem),
        `INTENTIONAL_NO_TEST.${stem} matches no foliplus/js/${stem}.ts`,
      ).toBe(true);
      expect(
        tests.includes(stem),
        `INTENTIONAL_NO_TEST.${stem} has a test file — drop the entry and let the mirror hold`,
      ).toBe(false);
    }
  });

  // ── Teeth ────────────────────────────────────────────────────────────────
  // The real tree proves today's cleanliness; these prove the rule has teeth
  // after a future relaxation. Each case is the exact drift the guard exists to
  // catch, fed through the same pure function the real assertions use.

  it("teeth: a test in the wrong tier is reported", () => {
    // A test in platform/ naming a module that lives under core/ is the
    // wrong-tier drift this guard exists to catch.
    expect(
      problemsFor(["platform/canvasAlpha"], new Set(["core/layer/canvasAlpha"])),
    ).toEqual(["platform/canvasAlpha"]);
    expect(
      problemsFor(["core/layer/canvasAlpha"], new Set(["core/layer/canvasAlpha"])),
    ).toEqual([]);
  });

  it("teeth: a feature-named test is reported", () => {
    expect(
      problemsFor(
        ["control/LayerControl/declaredBorder"],
        new Set(["control/LayerControl/declaredParse"]),
      ),
    ).toEqual(["control/LayerControl/declaredBorder"]);
  });

  it("teeth: the mirror is per-directory, not per-basename", () => {
    // The module exists, but at a different path: a basename match would call
    // this clean and quietly legalise the wrong-tier test.
    expect(problemsFor(["platform/guard"], new Set(["core/lifecycle/guard"]))).toEqual([
      "platform/guard",
    ]);
  });

  it("teeth: a shared-tier module with no test is reported", () => {
    expect(missingTestsFor(["ui/example"], new Set())).toEqual(["ui/example"]);
    expect(missingTestsFor(["ui/example"], new Set(["ui/example"]))).toEqual([]);
  });

  it("teeth: an aspect file resolves to its canonical module when the canonical test exists", () => {
    // controller.filter resolves to controller — the canonical test exists, so
    // this is legal (the aspect suffix carries one behaviour cluster).
    expect(
      problemsFor(
        ["control/LayerControl/controller", "control/LayerControl/controller.filter"],
        new Set(["control/LayerControl/controller"]),
      ),
    ).toEqual([]);
  });

  it("teeth: an aspect file whose module does not exist is reported", () => {
    // An aspect suffix cannot conjure a module: controller.filter with no
    // foliplus/js/control/LayerControl/controller.ts is module-less.
    expect(
      problemsFor(
        ["control/LayerControl/controller.filter"],
        new Set(["control/LayerControl/declaredParse"]),
      ),
    ).toEqual(["control/LayerControl/controller.filter"]);
  });

  it("teeth: an aspect file with no canonical test is reported", () => {
    // The module exists but was never tested by name: the aspect file alone
    // does not satisfy the mirror (the canonical file must exist).
    expect(
      problemsFor(
        ["control/LayerControl/controller.filter"],
        new Set(["control/LayerControl/controller"]),
      ),
    ).toEqual(["control/LayerControl/controller.filter"]);
  });

  it("teeth: two aspect files of one module may not claim the same word", () => {
    expect(
      aspectCollisions([
        "control/LayerControl/controller.filter",
        "control/LayerControl/controller.drag",
      ]),
    ).toEqual([]);
    expect(
      aspectCollisions([
        "control/LayerControl/controller.filter",
        "control/LayerControl/controller.filter",
      ]),
    ).toHaveLength(1);
  });

  it("teeth: a wrong-tier aspect is reported (the tier does not launder the aspect)", () => {
    // controller.filter living in platform/ does not resolve to a core/ module:
    // the aspect only carries the behaviour cluster, not a tier change.
    expect(
      problemsFor(
        ["platform/controller.filter"],
        new Set(["core/LayerControl/controller"]),
      ),
    ).toEqual(["platform/controller.filter"]);
  });
});
