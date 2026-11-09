import { describe, expect, it } from "vitest";
import {
  type Placement,
  type PlacementBox,
  type PlacementOpts,
  type SurfaceSize,
  clamp,
  computePlacement,
  intersect,
  isDegenerate,
} from "#ui/index.js";

const rect = (
  top: number,
  right: number,
  bottom: number,
  left: number,
): PlacementBox => ({
  top,
  right,
  bottom,
  left,
});

const viewport: PlacementBox = { top: 0, right: 1280, bottom: 720, left: 0 };

describe("clamp", () => {
  it("returns the value when inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
  it("floors at min", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
  });
  it("caps at max", () => {
    expect(clamp(12, 0, 10)).toBe(10);
  });
  it("returns min when the range is degenerate (min > max)", () => {
    expect(clamp(5, 10, 0)).toBe(10);
  });
});

describe("intersect", () => {
  it("returns the overlapping rectangle", () => {
    const a = rect(0, 200, 100, 0);
    const b = rect(50, 150, 150, 25);
    expect(intersect(a, b)).toEqual(rect(50, 150, 100, 25));
  });
  it("yields a degenerate rect for non-overlapping inputs", () => {
    const a = rect(0, 200, 100, 0);
    const b = rect(200, 300, 400, 100);
    expect(isDegenerate(intersect(a, b))).toBe(true);
  });
});

describe("isDegenerate", () => {
  it("is false for a real rectangle", () => {
    expect(isDegenerate(rect(0, 100, 50, 0))).toBe(false);
  });
  it("is true when top >= bottom", () => {
    expect(isDegenerate(rect(50, 100, 50, 0))).toBe(true);
  });
  it("is true when left >= right", () => {
    expect(isDegenerate(rect(0, 100, 50, 100))).toBe(true);
  });
});

describe("computePlacement — width strategy", () => {
  const anchor = rect(20, 220, 60, 120);
  const surface: SurfaceSize = { width: 200, height: 120 };

  it("defaults to the surface natural width", () => {
    const opts: PlacementOpts = {};
    const p: Placement = computePlacement(anchor, surface, viewport, opts);
    expect(p.maxWidth).toBe(200);
    expect(p.left).toBe(20);
    expect(p.side).toBe("below");
  });
  it("uses the anchor width when width: 'anchor'", () => {
    const p = computePlacement(anchor, surface, viewport, { width: "anchor" });
    expect(p.maxWidth).toBe(100);
    expect(p.left).toBe(120);
  });
  it("uses a fixed width when width is a number", () => {
    const p = computePlacement(anchor, surface, viewport, { width: 150 });
    expect(p.maxWidth).toBe(150);
    expect(p.left).toBe(70);
  });
  it("shrinks maxWidth to the bounds when the preferred width overflows", () => {
    const rightAnchor = rect(20, 1270, 60, 1170);
    const p = computePlacement(rightAnchor, surface, viewport, { width: 2000 });
    expect(p.maxWidth).toBe(1280);
    expect(p.left).toBe(0);
  });
});

describe("computePlacement — flip", () => {
  it("stays below when there is room below", () => {
    const anchor = rect(20, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, viewport);
    expect(p.side).toBe("below");
    expect(p.top).toBe(60);
  });
  it("flips above when below does not fit and above has more room", () => {
    const anchor = rect(660, 220, 700, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, viewport);
    expect(p.side).toBe("above");
    expect(p.top).toBe(540); // anchor.top - maxHeight (660 - 120)
  });
  it("stays below when below does not fit but above has no more room", () => {
    // Anchor spans the full height -> spaceBelow == spaceAbove -> below.
    const anchor = rect(0, 220, 720, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, viewport);
    expect(p.side).toBe("below");
  });
});

describe("computePlacement — height cap and row floor", () => {
  it("caps height to the available space in a short viewport", () => {
    // Short bounds (height 100); below fits only 40px, above 30px -> stays
    // below (above has no more room) and is capped to 40.
    const shortBounds: PlacementBox = rect(0, 1280, 100, 0);
    const anchor = rect(30, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, shortBounds);
    expect(p.side).toBe("below");
    expect(p.maxHeight).toBe(40);
    expect(p.top).toBe(60);
  });
  it("floors height at minRows * rowHeight", () => {
    const anchor = rect(20, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 40 }, viewport, {
      minRows: 3,
      rowHeight: 20,
    });
    expect(p.maxHeight).toBe(60);
  });
  it("keeps natural height when it is larger than the row floor", () => {
    const anchor = rect(20, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 100 }, viewport, {
      minRows: 2,
      rowHeight: 20,
    });
    expect(p.maxHeight).toBe(100);
  });
});

describe("computePlacement — clamping", () => {
  it("clamps top up into the bounds when the anchor sits above the bounds", () => {
    // Anchor above the bounds top; below strip chosen, natural top (60) is
    // above bounds.top (100) -> clamped up to 100.
    const bounds: PlacementBox = rect(100, 1280, 720, 0);
    const anchor = rect(20, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, bounds);
    expect(p.side).toBe("below");
    expect(p.top).toBe(100);
  });
  it("clamps top down into the bounds when the anchor sits below the bounds", () => {
    // Anchor below the bounds bottom; above strip chosen, natural top (380)
    // is below bounds.bottom - maxHeight (180) -> clamped down to 180.
    const bounds: PlacementBox = rect(0, 1280, 300, 0);
    const anchor = rect(500, 220, 540, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, bounds);
    expect(p.side).toBe("above");
    expect(p.top).toBe(180);
  });
  it("clamps left into the bounds when right-aligned past the left edge", () => {
    const anchor = rect(20, 100, 60, 0);
    const p = computePlacement(anchor, { width: 300, height: 100 }, viewport);
    expect(p.left).toBe(0);
  });
});

describe("computePlacement — DPR / fractional rectangles", () => {
  it("handles fractional anchor and surface coordinates", () => {
    const anchor = rect(20.5, 220.25, 60.75, 120.125);
    const p = computePlacement(anchor, { width: 200.5, height: 120.75 }, viewport);
    expect(p.side).toBe("below");
    expect(p.top).toBe(60.75);
    expect(p.maxWidth).toBe(200.5);
    expect(p.maxHeight).toBe(120.75);
  });
  it("returns bounded maxWidth/maxHeight when the surface exceeds the bounds", () => {
    const anchor = rect(20, 220, 60, 120);
    const tinyBounds: PlacementBox = rect(0, 50, 40, 0);
    const p = computePlacement(anchor, { width: 200, height: 120 }, tinyBounds);
    expect(p.maxWidth).toBe(50);
    expect(p.maxHeight).toBe(20);
  });
});

describe("computePlacement — degenerate / offscreen bounds", () => {
  it("handles bounds fully offscreen from the anchor", () => {
    const offscreen: PlacementBox = rect(1000, 1500, 1200, 800);
    const p = computePlacement(
      rect(1020, 1100, 1060, 1000),
      { width: 200, height: 100 },
      offscreen,
    );
    expect(p.maxWidth).toBe(200);
  });
});

describe("computePlacement — regression: strip vs bounds (Copilot #1)", () => {
  it("caps maxHeight to the bounds height when the surface is taller than the bounds", () => {
    const bounds: PlacementBox = rect(0, 1280, 300, 0); // height 300
    const anchor = rect(20, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 400 }, bounds);
    expect(p.maxHeight).toBeLessThanOrEqual(300);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300);
  });

  it("does not overflow when the anchor sits above the bounds", () => {
    const bounds: PlacementBox = rect(0, 1280, 300, 0); // height 300
    const anchor = rect(-100, 220, -60, 120); // above bounds top
    const p = computePlacement(anchor, { width: 200, height: 400 }, bounds);
    expect(p.maxHeight).toBeLessThanOrEqual(300);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300);
  });

  it("does not overflow when the anchor sits below the bounds", () => {
    const bounds: PlacementBox = rect(0, 1280, 300, 0); // height 300
    const anchor = rect(400, 220, 460, 120); // below bounds bottom
    const p = computePlacement(anchor, { width: 200, height: 400 }, bounds);
    expect(p.maxHeight).toBeLessThanOrEqual(300);
    expect(p.top).toBeGreaterThanOrEqual(0);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(300);
  });
});

describe("computePlacement — regression: row floor vs bounds (Copilot #2)", () => {
  it("gives the floor when the bounds can hold it", () => {
    const bounds: PlacementBox = rect(0, 1280, 100, 0); // height 100
    const anchor = rect(30, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, bounds, {
      minRows: 3,
      rowHeight: 20, // floor 60
    });
    expect(p.maxHeight).toBe(60);
  });

  it("caps at the bounds height when the floor exceeds the bounds", () => {
    const bounds: PlacementBox = rect(0, 1280, 40, 0); // height 40
    const anchor = rect(30, 220, 60, 120);
    const p = computePlacement(anchor, { width: 200, height: 120 }, bounds, {
      minRows: 3,
      rowHeight: 20, // floor 60 > bounds 40
    });
    expect(p.maxHeight).toBe(40);
  });
});
