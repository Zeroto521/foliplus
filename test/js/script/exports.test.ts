import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

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
