import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Resolved against cwd, the same repo root every build script assumes.
const ROOT = resolve(".");

const scriptModules = () =>
  globSync({
    cwd: ROOT,
    patterns: ["script/**/*.{js,cjs,mjs}"],
    ignore: ["node_modules/**", "script/sonda/**"],
  }).sort();

// A convention over every file in script/, not a test of one module — so the
// name is not a module name: there is no script/script-module-surface.mjs. The
// naming guard in test/js/toolchain-guards.test.ts records this as a declared
// exception instead of pretending this file tests a script.
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
