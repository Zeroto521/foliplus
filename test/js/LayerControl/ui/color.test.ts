import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { hideColorLayer } from "#foliplus/LayerControl/ui/color.js";
import { mapContainer } from "#foliplus/LayerControl/ui/context.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import type { LayerInfo } from "#foliplus/core/layer/index.js";

const makeUi = (): LayerUI => {
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-type="overlay">
      <input type="checkbox" data-index="0" />
    </div>
    <div class="foliplus-color-layer-item"></div>
  `;
  return {
    uiContainer,
    isColorActive: true,
    m: {
      map: {
        getPane: () => ({ classList: { remove: () => {}, add: () => {} } }),
      },
    },
  } as unknown as LayerUI;
};

describe("ui/color", () => {
  it("hideColorLayer clears the active flag and map container marker", () => {
    const ui = makeUi();
    mapContainer.classList.add(CONST.CLASSES.ACTIVE);
    mapContainer.style.setProperty("--color-layer-bg", "red");
    hideColorLayer(ui);
    expect(ui.isColorActive).toBe(false);
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("");
  });
});
