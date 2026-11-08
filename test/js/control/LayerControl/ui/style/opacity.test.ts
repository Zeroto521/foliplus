import { initFixture } from "../fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIM } from "#core/layer/index.js";
import { sliderOf } from "#ui/index.js";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { setIntent } from "#control/LayerControl/ui/intent.js";
import { clampPct } from "#control/LayerControl/ui/style/opacity.js";
import { getDimension } from "#control/LayerControl/ui/style/registry.js";

describe("opacityToPct clamp boundary (via OPACITY_DIMENSION.row)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const rowValue = (layerId: string): number => {
    const row = getDimension(DIM.OPACITY)!.row!(ui, layerId) as HTMLElement;
    const host = row.querySelector(".foliplus-slider") as HTMLElement;
    const value = sliderOf(host)!.value;
    return Array.isArray(value) ? value[0] : value;
  };

  it("clamps a corrupt persisted opacity above 1 to 100", () => {
    setIntent(ui, "overlay1", DIM.OPACITY, 1.5);
    expect(rowValue("overlay1")).toBe(100);
  });

  it("clamps a corrupt persisted opacity below 0 to 0", () => {
    setIntent(ui, "overlay1", DIM.OPACITY, -0.5);
    expect(rowValue("overlay1")).toBe(0);
  });

  it("renders a user opacity intent at its percentage", () => {
    setIntent(ui, "overlay1", DIM.OPACITY, 0.35);
    expect(rowValue("overlay1")).toBe(35);
  });

  it("renders fully opaque when no intent is set", () => {
    expect(rowValue("overlay1")).toBe(100);
  });

  it("a row for a vanished layer still renders fully opaque (undefined opacity)", () => {
    expect(rowValue("never-registered")).toBe(100);
  });

  it("clampPct clamps into [0,100] and rounds", () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(3.6)).toBe(4);
  });

  it("clampPct falls back on a non-finite raw value", () => {
    expect(clampPct(Number.NaN)).toBe(100);
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(100);
    expect(clampPct(Number.NaN, 42)).toBe(42);
  });
});
