import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { getLayerItems } from "#foliplus/LayerControl/ui/visibility.js";

const makeUi = (): LayerUI => {
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-type="base"></div>
    <div class="foliplus-layer-item" data-layer-type="overlay"></div>
    <div class="foliplus-color-layer-item"></div>
  `;
  return { uiContainer } as unknown as LayerUI;
};

describe("ui/visibility getLayerItems", () => {
  it("returns only base rows for the base group", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.BASE);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("base");
  });

  it("returns overlay rows and excludes the color basemap", () => {
    const ui = makeUi();
    const items = getLayerItems(ui, CONST.GROUP.OVERLAY);
    expect(items.length).toBe(1);
    expect(items[0].getAttribute("data-layer-type")).toBe("overlay");
  });
});
