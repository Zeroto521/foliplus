import { describe, expect, it, vi } from "vitest";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  applyHiddenOne,
  applyVisibleStateOne,
} from "#foliplus/LayerControl/ui/state.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

const makeUi = (hasLayer: boolean): LayerUI => {
  const layer = { on: vi.fn(), off: vi.fn() };
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-id="a">
      <input type="checkbox" checked />
    </div>
  `;
  return {
    uiContainer,
    m: {
      findLayer: vi.fn(() => layer),
      map: {
        hasLayer: vi.fn(() => hasLayer),
        removeLayer: vi.fn(),
        addLayer: vi.fn(),
      },
    },
  } as unknown as LayerUI;
};

describe("ui/state applyHiddenOne / applyVisibleStateOne", () => {
  it("applyHiddenOne removes a present layer and unchecks the row", () => {
    const ui = makeUi(true);
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyHiddenOne(ui, layerInfo, "a");
    expect(ui.m.map.removeLayer).toHaveBeenCalled();
    expect(layerInfo.visible).toBe(false);
    const box = ui.uiContainer.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    expect(box.checked).toBe(false);
  });

  it("applyHiddenOne fires onToggle(false) for a callback-only layer", () => {
    const ui = makeUi(false);
    (ui.m.findLayer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
    } as unknown as LayerInfo;
    applyHiddenOne(ui, layerInfo, "a");
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("applyVisibleStateOne re-adds a layer that is off the map", () => {
    const ui = makeUi(false);
    const onToggle = vi.fn();
    const layerInfo = {
      id: "a",
      onToggle,
      isBase: false,
    } as unknown as LayerInfo;
    applyVisibleStateOne(ui, layerInfo);
    expect(ui.m.map.addLayer).toHaveBeenCalled();
    expect(layerInfo.visible).toBe(true);
  });
});
