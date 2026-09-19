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
