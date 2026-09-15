import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Resolved against cwd, the same repo root every build script assumes.
const SCRIPT = resolve(process.cwd(), "script");

const modules = readdirSync(SCRIPT, { recursive: true })
  .filter((name): name is string => typeof name === "string")
  .filter(name => /\.(mjs|cjs|js)$/.test(name))
  .filter(name => !name.includes("sonda"))
  .map(name => resolve(SCRIPT, name));

// eslint.config.js bans inline `export` declarations for both foliplus/js and
// script/, so CI enforces the module surface. Reading the source here keeps the
// guard load-bearing even if the lint glob regresses.
describe("script module surface", () => {
  it("uses one trailing aggregate block, never an inline export", () => {
    for (const file of modules) {
      const src = readFileSync(file, "utf-8");
      const path = file.split(SCRIPT).pop()!.replace(/\\/g, "/");
      const decls = src.match(/^export\s+/gm) ?? [];

      expect(
        decls.length,
        `${path}: split export surface — one aggregate block only`,
      ).toBeLessThanOrEqual(1);
      expect(
        src,
        `${path}: inline export — use one export { … } block at the bottom`,
      ).not.toMatch(/^export\s+(?:const|let|var|function|class|default)\s/m);
    }
  });

  it("does not mix the two styles inside one module", () => {
    for (const file of modules) {
      const src = readFileSync(file, "utf-8");
      const path = file.split(SCRIPT).pop()!.replace(/\\/g, "/");
      const inline = /^export\s+(?:const|let|var|function|class)\s/m.test(src);
      const aggregate = /^export\s*\{/m.test(src);
      expect(
        inline && aggregate,
        `${path}: mixes inline exports with an aggregate block`,
      ).toBe(false);
    }
  });
});
