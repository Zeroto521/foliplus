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

  it("showColorLayer unchecks base rows by identity, not by DOM position", () => {
    // Registry: [overlay_1, base_1, base_2]
    // DOM:      [base_2, overlay_1, base_1]  (scrambled)
    // A positional read (inputs[j] vs layers[j]) would uncheck overlay_1's
    // checkbox (wrong row) and leave base_2's checked.  By data-layer-id the
    // correct base rows are targeted.
    const mapContainer = document.createElement("div");
    const uiContainer = document.createElement("div");

    const makeRow = (id: string, checked: boolean) => {
      const row = document.createElement("div");
      row.className = CONST.CLASSES.LAYER_ITEM;
      row.setAttribute(CONST.DATA.LAYER_ID, id);
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = checked;
      row.appendChild(box);
      return row;
    };

    const base2Row = makeRow("base_2", true);
    const overlayRow = makeRow("overlay_1", true);
    const base1Row = makeRow("base_1", true);
    uiContainer.appendChild(base2Row);
    uiContainer.appendChild(overlayRow);
    uiContainer.appendChild(base1Row);

    const colorRow = document.createElement("div");
    colorRow.className = `${CONST.CLASSES.LAYER_ITEM} ${CONST.CLASSES.COLOR_ITEM}`;
    colorRow.innerHTML = `<input type="color" class="${CONST.CLASSES.COLOR_INPUT}" />`;
    uiContainer.appendChild(colorRow);

    const layers = [
      { id: "overlay_1", isBase: false },
      { id: "base_1", isBase: true },
      { id: "base_2", isBase: true },
    ];

    const ui = {
      uiContainer,
      isColorActive: false,
      currentColor: "#cccccc",
      syncToggleAll: vi.fn(),
      m: {
        layers,
        findLayer: () => null,
        map: {
          getContainer: () => mapContainer,
          getPane: () => null,
          hasLayer: vi.fn(() => false),
          removeLayer: vi.fn(),
        },
      },
    } as unknown as LayerUI;

    showColorLayer(ui, "#ff0000");

    const base1Input = base1Row.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const base2Input = base2Row.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const overlayInput = overlayRow.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );

    expect(base1Input?.checked).toBe(false);
    expect(base2Input?.checked).toBe(false);
    expect(overlayInput?.checked).toBe(true);
  });
});
