// test/js/script/check/test-path-mirror — the test tree mirrors the production
// tree, in both directions.
//
// The rule (commit 3ecb1a494): a test file must name the module it tests, at
// that module's own path — test/js/core/layer/canvasAlpha.test.ts mirrors
// foliplus/js/core/layer/canvasAlpha.ts. A feature name ("declaredBorder") or a
// different tier ("platform/guard" for core/lifecycle/guard) hides the module
// from a reader and leaves the real module untested by name.
//
// Direction 1 (test -> module): every module test under test/js — outside
// test/js/script, which has its own mirror rule in toolchain-guard.test.ts —
// must resolve to foliplus/js/<same stem>.ts, unless named in NON_MIRRORED_TEST
// (or under a NON_MIRRORED_DIR) with the reason it has no single module.
//
// Direction 2 (module -> test): every executable module under the shared tiers
// (platform/, ui/, core/) must have a same-named test, unless named in
// INTENTIONAL_NO_TEST. Barrels and declaration-only files (index.ts, type.ts,
// const.ts, *ClassName.ts, *.d.ts) are exempt by kind: they carry no behaviour
// of their own. Component internals (control/) are covered by the integration
// and browser suites rather than same-named unit tests, so that tier is out of
// scope for this direction.
//
// Teeth: problemsFor()/missingTestsFor() are pure over an injected tree, and the
// cases below feed them a misplaced test, a feature-named test and a missing
// tier test. A relaxation into a prefix match or a category wildcard turns the
// real-tree assertions green while these stay red.
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
  "listener-guard":
    "production-tree listener registration guard (banned forms + allow-list), no single module",
  "toolchain-guard":
    "build/tooling configuration guard (eslint scoping, script coverage), no single module",
  tsconfig: "test TypeScript config guard, no single module",
  "control/ExportControl/decoupling":
    "reverse source-scan guard: ExportControl must not reference LayerControl internals, no single module",
  "control/LayerControl/filterApply":
    "cross-module filter-apply integration (controller + ui/style/icon + styleBag), no single module",
  "control/LayerControl/ui/childRegistration":
    "cross-module child-row integration: groupExpand registers the rows, orchestration/surface answer style + filter, the menu routes them, state.ts keeps their intents session-only — no single module",
  "control/LayerControl/ui/derivedState":
    "derived-state coherence guard across every registration path, no single module",
  "control/LayerControl/label/labelReplay-perf":
    "wall-clock gate for the label replay (control/LayerControl/label/index.ts renderLabels); the -perf suffix marks it a timing gate, not a mirror of a labelReplay-perf module",
};

/** Test directories that are categories, not mirrors (each file still names the
 *  module it exercises). */
const NON_MIRRORED_DIR: Record<string, string> = {
  perf: "wall-clock gates grouped by measurement category (see perf/collision.test.ts); each file still names the production module it times",
};

/** Executable modules with no same-named test, keyed by stem under foliplus/js/. */
const INTENTIONAL_NO_TEST: Record<string, string> = {
  "core/geo/geodesic":
    "turf geodesic wrapper exercised through MeasureControl's unit and browser suites",
  "core/interaction/interactionManager":
    "per-map interaction registry exercised through BaseControl and the browser suite",
  "core/layer/LayerOrder":
    "ordering helper exercised through the LayerControl list and perf suites",
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

/** Direction 1: a test must name a module at the exact mirrored path. */
const problemsFor = (tests: string[], modules: Set<string>): string[] =>
  tests.filter(stem => !modules.has(stem) && !isNonMirrored(stem));

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
});
