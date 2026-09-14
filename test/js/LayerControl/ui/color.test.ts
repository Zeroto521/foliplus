import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { hideColorLayer, showColorLayer } from "#foliplus/LayerControl/ui/color.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";

const makeUi = (layers: Array<{ isBase: boolean }> = []) => {
  const mapContainer = document.createElement("div");
  const uiContainer = document.createElement("div");
  uiContainer.innerHTML = `
    <div class="foliplus-layer-item" data-layer-type="overlay">
      <input type="checkbox" data-index="0" />
    </div>
    <div class="foliplus-color-layer-item"></div>
  `;
  const ui = {
    uiContainer,
    isColorActive: true,
    syncToggleAll: vi.fn(),
    m: {
      layers,
      findLayer: () => ({ isBase: true }),
      map: {
        getContainer: () => mapContainer,
        getPane: () => ({ classList: { remove: () => {}, add: () => {} } }),
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
      },
    },
  } as unknown as LayerUI;
  return { ui, mapContainer };
};

describe("ui/color", () => {
  it("hideColorLayer clears the active flag and map container marker", () => {
    const { ui, mapContainer } = makeUi();
    mapContainer.classList.add(CONST.CLASSES.ACTIVE);
    mapContainer.style.setProperty("--color-layer-bg", "red");
    hideColorLayer(ui);
    expect(ui.isColorActive).toBe(false);
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("");
  });

  it("showColorLayer paints the container and hides base layers", () => {
    const { ui, mapContainer } = makeUi([{ isBase: true }]);
    showColorLayer(ui, "#ff0000");
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("#ff0000");
    const map = ui.m.map as unknown as { removeLayer: ReturnType<typeof vi.fn> };
    expect(map.removeLayer).toHaveBeenCalled();
  });
});
