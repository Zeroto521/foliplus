import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Guards on the build toolchain: how the scripts expose themselves, how the
// `#script/*` alias is declared, how the lint config claims them, and that
// test/js/script/ mirrors script/ — one test file per real module, subdirectories
// included. None of these test a module in script/, so none of them live in
// test/js/script/: that directory stays a strict one-test-file-per-module
// mapping, and this file — named for what it guards, not for a module — owes
// no entry to the naming rule it enforces.
//
// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
// The rules moved to config/eslint/base.mjs; the root file is now a
// re-export. Reading the root file would parse zero `files: [...]` blocks and
// the scoping assertions below would go decorative — a thinner entry file
// would silently pass a guard that exists to catch glob typos.
const lintConfig = readFileSync(resolve(ROOT, "config/eslint/base.mjs"), "utf8");
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
//
// The vitest half is not a hand-copied `resolve("script")` — it imports
// `testPathAliases` from script/build/build-path.mjs. This suite pins that wiring so
// a future drift fails here instead of at test import time.
describe("#script/* import alias", () => {
  it("package.json imports points #script/* at ./script/*", () => {
    expect(pkg.imports["#script/*"]).toBe("./script/*");
  });

  it("vitest resolve.alias maps #script via the build-path single source", () => {
    expect(vitestConfig).toMatch(/testPathAliases\s*\(/);
    expect(existsSync(resolve(ROOT, "script/build/build-path.mjs"))).toBe(true);
  });

  it("test/js tsconfig keeps the #script/* mapping live", () => {
    expect(testTsconfig).toMatch(/"#script\/\*"\s*:\s*\[\s*"\.\.\/\.\.\/script\/\*"/);
  });

  it("the mapped directory exists on disk", () => {
    expect(existsSync(resolve(ROOT, "script"))).toBe(true);
  });
});

// config/eslint/base.mjs is its own dead-config risk: a typo in one of its
// globs silently un-exempts half the tree, and nothing in the output mentions
// it.
describe("config/eslint/base.mjs rule scoping", () => {
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

  it("component-isolation zones target the control/ namespace", () => {
    // Counter-proof for the directory move: after JS sources moved to
    // foliplus/js/control/<Name>/, the no-restricted-paths zone targets and
    // COMPONENT_GLOBS had to follow. A stale glob (still foliplus/js/<Name>/)
    // matches nothing and silently disables component isolation.
    expect(lintConfig).toContain("foliplus/js/control/${d}/**");
    expect(lintConfig).toContain("target: [`./foliplus/js/control/${dir}/**`]");
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

// The lint config is the one file whose job is to check everything else, and it
// silently escaped every gate until this was written: a file outside the lint
// globs is a file no rule can reach, and nothing in the output says so.
describe("lint config is itself linted", () => {
  it("npm scripts cover every config file, in every gate", () => {
    // Symmetric on purpose: a per-script hand list is how `format:check` came to
    // cover config/ but not the root entry — the same half-covered shape the
    // rest of this block exists to catch.
    for (const script of ["lint", "format:check"] as const) {
      for (const file of ["config/**/*.mjs", "eslint.config.js"]) {
        expect(pkg.scripts[script], `${script} does not cover ${file}`).toContain(file);
      }
    }
  });

  it("every linted config file is claimed by a rule block", () => {
    // Without a `files:` block a file only inherits
    // `tseslint.configs.recommended` (23 rules); a block is what makes the
    // project's own rules apply (60+). The check runs over every config file
    // the lint script claims, so the next one added cannot fall back to the
    // recommended set unnoticed.
    const blocks = fileGlobs();
    const claimed = (file: string) => blocks.some(globs => globs.includes(file));
    for (const file of ["config/**/*.mjs", "eslint.config.js"]) {
      expect(claimed(file), `${file} is linted but no files: block claims it`).toBe(
        true,
      );
    }
  });
});

// The root entry must re-export the implementation, not redefine it. Without
// this, a future edit could put rules back in the root file and the guard
// above would keep passing against a stale implementation file.
describe("eslint root entry", () => {
  it("re-exports the implementation config", () => {
    const entry = readFileSync(resolve(ROOT, "eslint.config.js"), "utf8");
    expect(entry).toMatch(
      /export\s*\{\s*default\s*\}\s*from\s*"\.\/config\/eslint\/base\.mjs"/,
    );
  });

  it("holds no rule definitions of its own", () => {
    const entry = readFileSync(resolve(ROOT, "eslint.config.js"), "utf8");
    expect(entry).not.toMatch(/files:\s*\[/);
  });
});

// A test file's "subject stem" is its path relative to test/js/script/, minus
// the .test.ts extension: test/js/script/build/build.test.ts has stem
// "build/build", test/js/script/args.test.ts has stem "args". The module side
// uses the same convention under script/: the stem of script/build/build.mjs
// is also "build/build". The two must match segment-for-segment — a test under
// tool/ claiming a module under build/ (or vice versa) is a broken mirror, not
// a renamed file.
//
// Two stems have no module to code against: Makefile.test.ts and
// vitest.config.test.ts point at repo-root files that are not in script/. One
// entry per exception, each naming what the file really tests.
const NON_MODULE_TEST_SUBJECTS: Record<string, string> = {
  Makefile: "the root Makefile",
  "vitest.config": "vitest.config.mjs",
  "filter-store-single-source":
    "the generic-filter single-source + storage-boundary guard over foliplus/js production (controller must not reintroduce a layerFilters mirror; filter persistence only through the shared store), a tree guard not a script module",
  "import-boundary":
    "the JS layer import-boundary rules (foliplus/js), a tree guard not a script module",
};

// `test/js/script/<stem>.test.ts` has a subject when a module exists at the
// exact mirrored path `script/<stem>.{js,cjs,mjs}`, or a co-located module at
// `test/js/script/<stem>.{js,cjs,mjs}` (fixture-generation utilities), or
// `<stem>` is on the exception list above. Anything else is a fossil: a test
// file named for something that does not exist.
const hasSubject = (stem: string) =>
  ["mjs", "cjs", "js"].some(
    ext =>
      globSync({
        cwd: ROOT,
        patterns: [`script/${stem}.${ext}`],
      }).length > 0 ||
      globSync({
        cwd: ROOT,
        patterns: [`test/js/script/${stem}.${ext}`],
      }).length > 0,
  ) || stem in NON_MODULE_TEST_SUBJECTS;

describe("test/js/script naming", () => {
  it("every test file names the module it tests", () => {
    const tests = globSync({
      cwd: ROOT,
      patterns: ["test/js/script/**/*.test.ts"],
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
        `${rel}: tests no script/${stem}.{mjs,cjs,js} — rename it after the module, or add an entry saying what it tests.\nKnown exceptions:\n${exceptions}`,
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
    // would go decorative and no test would notice. The fossil names are real:
    // namespace-plugin.test.ts tested a script that never existed; exports.test.ts
    // was the same pattern, testing package.json and eslint.config.js rather than
    // any script/exports.mjs; script-module-surface.test.ts sat in test/js/script/
    // named for a convention across script/ instead of a module inside it.
    expect(hasSubject("namespace-plugin")).toBe(false);
    expect(hasSubject("exports")).toBe(false);
    expect(hasSubject("script-module-surface")).toBe(false);
    expect(hasSubject("never-a-module")).toBe(false);
    expect(hasSubject("global-namespace-plugin")).toBe(false);
    expect(hasSubject("build/global-namespace-plugin")).toBe(true);
    expect(hasSubject("Makefile")).toBe(true);
  });

  it("rejects a test mirrored into the wrong script subdirectory", () => {
    // The mirror rule is per-directory, not per-basename: a build/ test moved
    // under tool/ still names an existing module by basename, but its path stem
    // ("tool/build") no longer resolves to script/tool/build.mjs. Regressions
    // here mean the subdirectory symmetry of the mirror is being erased.
    expect(hasSubject("tool/build")).toBe(false);
    expect(hasSubject("build/build")).toBe(true);
  });
});

// The naming rule above runs one way: every test file must name a real module.
// The other direction — every module must have a test file — was the blind
// spot that left script/build/glyph.mjs uncovered. A module without a test can never
// be an accident: it is either tested, or named here with the reason it
// cannot be. The list is empty today; keeping it is what makes the gap below
// deliberate instead of silent.
const INTENTIONAL_NO_TEST: Record<string, string> = {};

// Same path-stem convention as the naming rule: script/build/build.mjs -> "build/build".
const scriptStem = (rel: string) =>
  rel.replace(/^script\//, "").replace(/\.(mjs|cjs|js)$/, "");

const scriptTestStems = (): Set<string> =>
  new Set(
    globSync({ cwd: ROOT, patterns: ["test/js/script/**/*.test.ts"] })
      .sort()
      .map(rel => rel.replace(/^test\/js\/script\//, "").replace(/\.test\.ts$/, "")),
  );

const isCovered = (stem: string) =>
  scriptTestStems().has(stem) || stem in INTENTIONAL_NO_TEST;

describe("script module coverage", () => {
  it("every script module is tested, or named as deliberately untested", () => {
    const intentional = Object.entries(INTENTIONAL_NO_TEST)
      .map(([k, v]) => `  ${k} — ${v}`)
      .join("\n");

    for (const rel of scriptModules()) {
      const stem = scriptStem(rel);
      expect(
        isCovered(stem),
        `${rel}: no test/js/script/${stem}.test.ts — add one, or name it as deliberately untested with the reason.\nKnown intentional gaps:\n${intentional}`,
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
    expect(isCovered("build/glyph")).toBe(true);
    expect(isCovered("build/compress")).toBe(true);
    expect(isCovered("compress")).toBe(false);
    expect(isCovered("tool/build")).toBe(false);
    expect(isCovered("never-a-module")).toBe(false);
  });
});

describe("event-name guard wiring", () => {
  it("npm run lint chains the event-name guard inline", () => {
    const lint = pkg.scripts.lint;
    expect(lint).toContain("node script/check/event-name.mjs");
    // eslint must still follow the guard in the same chain.
    expect(lint.indexOf("eslint")).toBeGreaterThan(lint.indexOf("event-name"));
  });

  it("no standalone guard:event-name npm script exists", () => {
    expect(pkg.scripts["guard:event-name"]).toBeUndefined();
  });

  it("removing the inline guard from the lint chain must fail the assertion", () => {
    const lint = pkg.scripts.lint;
    const without = lint.replace(/node script\/check\/event-name\.mjs(?: && )?/g, "");
    expect(without).not.toContain("event-name");
    // The original chain must contain it.
    expect(lint).toContain("event-name");
  });
});

describe("style-mode-usage guard wiring", () => {
  it("npm run lint chains the style-mode guard inline", () => {
    const lint = pkg.scripts.lint;
    expect(lint).toContain("node script/check/style-mode-usage.mjs --check");
    expect(lint).toContain(
      "node script/check/style-mode-usage.mjs --check-legacy-alias",
    );
    // eslint must still follow the guards in the same chain.
    expect(lint.indexOf("eslint")).toBeGreaterThan(lint.indexOf("style-mode-usage"));
  });

  it("no standalone guard:style-mode npm script exists", () => {
    expect(pkg.scripts["guard:style-mode"]).toBeUndefined();
  });

  it("removing the inline guards from the lint chain must fail the assertion", () => {
    const lint = pkg.scripts.lint;
    const without = lint.replace(
      /node script\/check\/style-mode-usage\.mjs --check(?: && )?/g,
      "",
    );
    expect(without).not.toContain("style-mode-usage");
    // The original chain must contain them.
    expect(lint).toContain("style-mode-usage");
  });
});

// Every guard in test/js/guard/ is registered here with the invariant it
// guards. The directory is a category, not a mirror (see the layout block
// below), so a new guard file has no naming rule to satisfy — without this
// table it could land unannounced and nothing would say what it protects.
// Adding a guard means adding its entry in the same commit; the layout block
// fails on an unregistered file and on a stale entry.
const GUARD_TREE_SUBJECTS: Record<string, string> = {
  "async-liveness":
    "async continuations must not outlive the component that mounted them",
  "bare-timer":
    "delayed work goes through the timer owner, not a bare setTimeout/setInterval/rAF",
  "browser-snippet":
    "every browser probe is cited by a consumer and no two probes share a body",
  "config-contract-keys":
    "the CONFIG payload keeps one snake_case key spelling across Python and JS",
  "deep-relative-path":
    "no test file reaches outside its own subtree with three or more ../ segments",
  "order-vocabulary":
    "the order-domain kind/key-prefix vocabulary is single-sourced in order/kind.ts + const.ts ROLE, not spelled as bare layer/folder/group/overlay/base literals",
  "derived-barrier":
    "derived-state projections run only through the invalidateDerived barrier",
  "export-decoupling": "ExportControl must not reference LayerControl internals",
  "file-header":
    "the canonical file header stays on every registered module, every script/ tool and every control/ module",
  "fold-arrow": "how far a row is opened is one state, not a per-arrow copy",
  "folder-name-fold-sync":
    "the folder-name fold rule is the same on the Python and JS sides",
  "folder-name-limit":
    "the folder-name length bound is the same on the Python and JS sides",
  "folder-name-max-sync": "FOLDER_NAME_MAX is one number, not two hand-copied literals",
  "glyph-prefix-guard":
    "the panel glyph prefix is single-sourced while the author prefix stays free-form",
  "hex-color-sync":
    "the Python declaration reader and the JS color primitive judge hex shapes alike",
  "keyboard-ownership":
    "Arrow/Escape handling goes through the shared keyboard primitive",
  "label-size-sync":
    "the label font-size bounds are the same numbers on the Python and JS sides",
  "listener-guard":
    "raw listener registrations carry an adjacent // listener-exempt: comment",
  "marker-color-preset":
    "MARKER_COLOR_PRESET_HEX stays self-consistent in both directions",
  "marker-icon-set-icon-guard":
    "marker icon writes flow only through the whitelisted setLeafIcon call site",
  "mock-specifier": "every vi.mock/vi.doMock specifier resolves to a real file",
  "number-format-sync":
    "the label number-format vocabulary is one list across Python, the generated schema and JS",
  "order-source":
    "the layer_order document is the single source of panel order / map z / panel blocks; legacy order representations and registry reorder mutations are gone"
  "role-words-sync": "the layer-role vocabulary is the same on the Python and JS sides",
  "selected-class-guard": "the selected-class spelling has one owner per widget",
  "single-source-primitives":
    "the three #1407 single-source primitives keep exactly one definition and one copy of every driftable shape in foliplus/js",
  "slider-inset": "the slider half-thumb offset is one token, not a repeated calc",
  "row-identity":
    "every row builder emits the shared .foliplus-row identity class, and role-header rows are first-class in it",
  "storage-key-scope":
    "every persisted record key derives from the per-map storage scope",
  "style-dimension-cycle":
    "the border and fill style dimensions do not form a module cycle",
  "task-number-drift":
    "internal task identifiers never leak into source, tests or comments",
  "teardown-step-name":
    "every semantic event derives one unique, greppable teardown step name",
  "test-path-mirror": "the test tree mirrors the production tree in both directions",
  "v8-ignore": "v8-ignore comments stay on the lines they claim",
  vocabulary:
    "LayerRole is the single word for the overlay/base grouping, with no middle-layer vocabulary",
};

// Layout of the guard tree (single source of truth for "where does a guard live").
//
// `script/check/` holds the executable guards; `test/js/script/check/` mirrors
// them one-to-one (the naming rule this file already enforces). A guard that
// asserts a REPO-WIDE invariant over `foliplus/js/**` — vocabulary, listener
// registration, header drift, … — has no `script/check/<name>.mjs` twin, so it
// is not a mirror and must not sit in the mirror directory pretending to be
// one: it lives in `test/js/guard/`. Physical location then says what a test is,
// and the allow-list that used to excuse the misplaced ones shrinks away.
describe("guard-tree layout", () => {
  const GUARD_DIR = resolve(ROOT, "test/js/guard");
  const CHECK_DIR = resolve(ROOT, "test/js/script/check");

  const checkTests = () =>
    readdirSync(CHECK_DIR)
      .filter(n => n.endsWith(".test.ts"))
      .map(n => n.replace(/\.test\.ts$/, ""))
      .sort();

  it("every test in script/check/ mirrors a script/check/<name>.mjs", () => {
    const orphans = checkTests().filter(
      n => !existsSync(resolve(ROOT, "script/check", `${n}.mjs`)),
    );
    expect(
      orphans,
      `no script/check/<name>.mjs twin — move to test/js/guard/: ${orphans.join(", ")}`,
    ).toEqual([]);
  });
