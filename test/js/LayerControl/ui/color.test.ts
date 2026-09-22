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

  uiContainer.insertAdjacentHTML(
    "beforeend",
    `<div class="${CONST.CLASSES.COLOR_ITEM}"></div>`,
  );

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
    const { ui, mapContainer } = makeUi([{ id: "base_1", isBase: true }]);
    showColorLayer(ui, "#ff0000");
    expect(mapContainer.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
    expect(mapContainer.style.getPropertyValue("--color-layer-bg")).toBe("#ff0000");
    const map = ui.m.map as unknown as { removeLayer: ReturnType<typeof vi.fn> };
    expect(map.removeLayer).toHaveBeenCalled();
  });

  it("showColorLayer skips removeLayer when the base layer is not on the map", () => {
    const { ui, mapContainer } = makeUi([{ id: "base_1", isBase: true }]);
    const map = ui.m.map as unknown as {
      hasLayer: ReturnType<typeof vi.fn>;
      removeLayer: ReturnType<typeof vi.fn>;
    };
    map.hasLayer.mockReturnValue(false);
    showColorLayer(ui, "#ff0000");
    expect(map.removeLayer).not.toHaveBeenCalled();
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
    base2Row.classList.add(CONST.CLASSES.ACTIVE);
    overlayRow.classList.add(CONST.CLASSES.ACTIVE);
    base1Row.classList.add(CONST.CLASSES.ACTIVE);
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

    expect(base1Row.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(base2Row.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(overlayRow.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("showColorLayer skips a base layer whose row is not yet rendered", () => {
    // Registry: [base_missing, base_present] — base_missing is registered
    // but its row has not landed in the DOM yet (late-registration window).
    // The loop must not throw; it clears base_present and skips base_missing.
    const { ui } = makeUi([{ id: "base_present", isBase: true }]);

    // Add base_missing to the registry without adding its row to the DOM.
    ui.m.layers.unshift({ id: "base_missing", isBase: true } as never);

    expect(() => showColorLayer(ui, "#ff0000")).not.toThrow();

    const presentRow = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="base_present"]`,
    );
    expect(presentRow?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    const presentInput = presentRow?.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(presentInput?.checked).toBe(false);
  });

  it("showColorLayer removes ACTIVE from a row without a checkbox", () => {
    // A row exists but has no checkbox input (e.g., partially rendered).
    // The guard skips the unchecked call but still removes ACTIVE.
    const { ui, mapContainer } = makeUi([{ id: "base_nochk", isBase: true }]);

    // Replace the checkbox with nothing — row exists, but no input.
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="base_nochk"]`,
    );
    row!.innerHTML = "";
    row!.classList.add(CONST.CLASSES.ACTIVE);

    expect(() => showColorLayer(ui, "#ff0000")).not.toThrow();
    expect(row!.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
  });
});
