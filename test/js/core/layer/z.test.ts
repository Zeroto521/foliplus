import { describe, expect, it } from "vitest";
import { Z_INDEX } from "#foliplus/core/layer/const.js";
import {
  ANNOTATION_Z_OFFSET,
  FOCUS_Z,
  focusLayerZ,
  zFor,
} from "#foliplus/core/layer/z.js";

describe("zFor slots", () => {
  it("prices a layer's slot from its index: index 0 is topmost", () => {
    const count = 3;
    expect(zFor({ index: 0, count })).toBe(Z_INDEX.BASE + 3 * Z_INDEX.STEP);
    expect(zFor({ index: 1, count })).toBe(Z_INDEX.BASE + 2 * Z_INDEX.STEP);
    expect(zFor({ index: 2, count })).toBe(Z_INDEX.BASE + Z_INDEX.STEP);
  });

  it("puts the last layer one step above the base, not on it", () => {
    // The ordering pass prices index `i` at `base + (count - i) * STEP`, so the
    // bottom layer sits at base + STEP. The base itself is only what an
    // unclaimed slot is given (see below).
    expect(zFor({ index: 2, count: 3 })).toBe(Z_INDEX.BASE + Z_INDEX.STEP);
  });

  it("prices tile layers from the tile base", () => {
    expect(zFor({ index: 0, count: 2, tile: true })).toBe(
      Z_INDEX.TILE_BASE + 2 * Z_INDEX.STEP,
    );
    expect(zFor({ index: 1, count: 2, tile: true })).toBe(
      Z_INDEX.TILE_BASE + Z_INDEX.STEP,
    );
  });

  it("adds the pane's draw offset to its layer's slot", () => {
    const slot = zFor({ index: 1, count: 3 });
    expect(zFor({ index: 1, count: 3, order: 1 })).toBe(slot + 1);
    expect(zFor({ index: 1, count: 3, order: 2 })).toBe(slot + 2);
  });

  it("prices an annotation pane one step above its layer, not at its own order", () => {
    expect(ANNOTATION_Z_OFFSET).toBe(1);
    const slot = zFor({ index: 1, count: 3 });
    expect(zFor({ index: 1, count: 3, role: "annotation" })).toBe(slot + 1);
    expect(zFor({ index: 1, count: 3, role: "annotation", order: 4 })).toBe(slot + 1);
  });

  it("prices a pane at the stack base while no slot has been claimed", () => {
    expect(zFor({})).toBe(Z_INDEX.BASE);
    expect(zFor({ order: 2 })).toBe(Z_INDEX.BASE + 2);
  });

  it("prices an absolute base instead of a slot", () => {
    expect(zFor({ base: 8990 })).toBe(8990);
    expect(zFor({ base: 8990, order: 2 })).toBe(8992);
    expect(zFor({ base: 8990, role: "annotation" })).toBe(8991);
    // The base wins over index/count/tile.
    expect(zFor({ base: 8990, index: 0, count: 9, tile: true })).toBe(8990);
  });
});

describe("the focus ladder", () => {
  it("lifts a layer one gap below the focus overlay", () => {
    expect(FOCUS_Z.overlay).toBe(9000);
    expect(FOCUS_Z.gap).toBe(10);
    expect(focusLayerZ()).toBe(FOCUS_Z.overlay - FOCUS_Z.gap);
    expect(focusLayerZ()).toBe(8990);
  });

  it("sits above the highest layer pane", () => {
    expect(focusLayerZ()).toBeGreaterThan(zFor({ index: 0, count: 200 }));
  });

  it("prices the panes above the raised layer in order: labels, markers, tooltip, popup", () => {
    expect(zFor({ base: focusLayerZ(), role: "annotation" })).toBe(8991);
    expect(zFor({ base: focusLayerZ(), order: 2 })).toBe(8992);
    expect(zFor({ base: focusLayerZ(), order: 3 })).toBe(8993);
    expect(zFor({ base: focusLayerZ(), order: 4 })).toBe(8994);
    // Every one of them stays under the mask.
    expect(zFor({ base: focusLayerZ(), order: 4 })).toBeLessThan(FOCUS_Z.overlay);
  });
});
