import { describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyHiddenOne,
  applyVisibleStateOne,
} from "#foliplus/LayerControl/ui/state.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

const makeUi = (): LayerUI => {
  const onToggle = vi.fn();
  return {
    m: {
      findLayer: vi.fn(() => ({ on: vi.fn(), off: vi.fn() })),
      map: {
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
        addLayer: vi.fn(),
      },
    },
    hideColorLayer: vi.fn(),
  } as unknown as LayerUI;
};

describe("ui/state applyHiddenOne / applyVisibleStateOne", () => {
  it("applyHiddenOne removes the layer and fires onToggle(false)", () => {
    const ui = makeUi();
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyHiddenOne(ui, layerInfo, "a");
    expect(ui.m.map.removeLayer).toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("applyVisibleStateOne re-adds a layer the user un-hid", () => {
    const ui = makeUi();
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyVisibleStateOne(ui, layerInfo);
    expect(ui.m.map.addLayer).toHaveBeenCalled();
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
