import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { hideColorLayer, showColorLayer } from "#foliplus/LayerControl/ui/color.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";

const makeUi = (layers: Array<{ id: string; isBase: boolean }> = []) => {
  const mapContainer = document.createElement("div");
  const uiContainer = document.createElement("div");

  for (const layer of layers) {
    const row = document.createElement("div");
    row.className = CONST.CLASSES.LAYER_ITEM;
    row.setAttribute(CONST.DATA.LAYER_ID, layer.id);
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    row.appendChild(box);
    uiContainer.appendChild(row);
  }

  const colorRow = document.createElement("div");
  colorRow.className = CONST.CLASSES.COLOR_ITEM;
  colorRow.innerHTML = `<input type="color" class="${CONST.CLASSES.COLOR_INPUT}" />`;
  uiContainer.appendChild(colorRow);

  const ui = {
    uiContainer,
    syncToggleAll: vi.fn(),
    userOverrides: {},
    hiddenIds: new Set<string>(),
    authorVisible: new Map<string, boolean>(),
    renamedNames: {},
    zoomRangeMap: {},
    focusingLayerId: null,
    mgmt: { getFeatureCount: () => null },
    T: () => "",
    conf: { locale_code: "en" },
    m: {
      layers,
      findLayer: () => ({ isBase: true }),
      layerRegistry: new Map(),
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
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("");
  });

  it("showColorLayer paints the container and marks the row active", () => {
    const { ui, mapContainer } = makeUi();
    showColorLayer(ui, "#ff0000");
    expect(ui.currentColor).toBe("#ff0000");
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("#ff0000");
    const colorRow = ui.uiContainer.querySelector<HTMLElement>(CONST.SEL.COLOR_ITEM);
    expect(colorRow?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("showColorLayer leaves base layers on the map and the shared tilePane untouched", () => {
    // First-class basemap: colour and tiles coexist. The colour layer must
    // not remove any tile layer from the map nor hide Leaflet's shared
    // tilePane —those were the global side effects the mutual exclusion
    // removed.
    const { ui } = makeUi([
      { id: "base_1", isBase: true },
      { id: "base_2", isBase: true },
    ]);
    const tilePane = { classList: { add: vi.fn(), remove: vi.fn() } };
    (ui.m.map as unknown as { getPane: () => typeof tilePane }).getPane = () =>
      tilePane;
    const removeLayer = (
      ui.m.map as unknown as { removeLayer: ReturnType<typeof vi.fn> }
    ).removeLayer;
    removeLayer.mockClear();

    showColorLayer(ui, "#ff0000");

    expect(removeLayer).not.toHaveBeenCalled();
    expect(tilePane.classList.add).not.toHaveBeenCalled();
    expect(tilePane.classList.remove).not.toHaveBeenCalled();
  });

  it("showColorLayer does not repaint base rows' checkboxes or active class", () => {
    // The colour layer is one row like any other; it must not paint
    // neighbouring rows' state. Intent-only invariant: a derived decision
    // (this colour layer became active) never authorises unchecking a
    // basemap the user explicitly chose.
    const { ui } = makeUi([
      { id: "base_1", isBase: true },
      { id: "overlay_1", isBase: false },
    ]);
    const rows = [
      ...ui.uiContainer.querySelectorAll<HTMLElement>(CONST.SEL.LAYER_ITEM),
    ];
    const before = rows.map(row => ({
      checked: row.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked,
      active: row.classList.contains(CONST.CLASSES.ACTIVE),
    }));
    rows[0].classList.add(CONST.CLASSES.ACTIVE);

    showColorLayer(ui, "#ff0000");

    rows.forEach((row, i) => {
      const after = {
        checked: row.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked,
        active: row.classList.contains(CONST.CLASSES.ACTIVE),
      };
      // Checkboxes are untouched either way.
      expect(after.checked).toBe(before[i].checked);
    });
    // The row that started active stays active.
    expect(rows[0].classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("showColorLayer tolerates a row without a checkbox (partially rendered)", () => {
    const { ui } = makeUi([{ id: "base_nochk", isBase: true }]);
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="base_nochk"]`,
    );
    row!.innerHTML = "";
    expect(() => showColorLayer(ui, "#ff0000")).not.toThrow();
  });
});
