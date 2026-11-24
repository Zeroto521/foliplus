import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Style-dimension layering guard: the border and fill dimensions must not
// form a module cycle. ESM tolerates a cycle at runtime, but it makes init
// order fragile, defeats tree-shaking layering, and the import-boundary rule
// cannot express "who depends on whom". The cross-face replay (fill asks the
// stroke face to re-apply after a fill commit) must go through the neutral
// replay.ts bridge instead.
//
// The fixed DAG edge is border.ts -> fill.ts (border reads the fill mode/value
// to decide its own mode). The cycle was created by the NEW direction
// (fill.ts -> border.ts); forbidding that one direction keeps the pair acyclic,
// because border->fill can never be removed.
const STYLE_DIR = resolve(
  process.cwd(),
  "foliplus",
  "js",
  "control",
  "LayerControl",
  "ui",
  "style",
);

describe("style dimensions stay a DAG (no fill -> border cycle)", () => {
  it("fill.ts does not import border.ts (the cycle-forming direction)", () => {
    const src = readFileSync(resolve(STYLE_DIR, "fill.ts"), "utf-8");
    expect(src).not.toMatch(/from ".\/border\.js"/);
    expect(src).not.toMatch(/import\(".*\/border\.js"\)/);
  });

  it("border.ts keeps the legitimate fill import (fixed DAG edge)", () => {
    const src = readFileSync(resolve(STYLE_DIR, "border.ts"), "utf-8");
    expect(src).toMatch(/from ".\/fill\.js"/);
  });
});
