import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  getLayerItems,
  handleInput,
  syncVisibility,
} from "#foliplus/LayerControl/ui/visibility.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

const makeUi = (): LayerUI => {
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-type="base"></div>
    <div class="foliplus-layer-item" data-layer-type="overlay">
      <input type="checkbox" data-index="0" />
    </div>
    <div class="foliplus-color-layer-item"></div>
  `;
  return { uiContainer } as unknown as LayerUI;
};

describe("ui/visibility", () => {
  it("getLayerItems returns only base rows for the base group", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.BASE);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("base");
  });

  it("getLayerItems returns overlay rows and excludes the color basemap", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.OVERLAY);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("overlay");
  });

  it("syncVisibility falls back when the Leaflet layer is absent", () => {
    const layerInfo = { id: "a", visible: false } as LayerInfo;
    expect(syncVisibility(makeUi(), layerInfo, null, true)).toBe(true);
    expect(layerInfo.visible).toBe(true);
    expect(syncVisibility(makeUi(), layerInfo, null, false)).toBe(false);
    expect(layerInfo.visible).toBe(false);
  });

  it("handleInput is a no-op for non-color inputs", () => {
    const ui = makeUi();
    const input = ui.uiContainer.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement;
    expect(() => handleInput(ui, { target: input } as unknown as Event)).not.toThrow();
  });
});
