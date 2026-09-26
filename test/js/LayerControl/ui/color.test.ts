import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { hideColorLayer, showColorLayer } from "#foliplus/LayerControl/ui/color.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";

const makeUi = (layers: Array<{ id: string; isBase: boolean }> = []) => {
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

  // The color basemap owns a dedicated pane + canvas (via factory.createColor),
  // not a container CSS variable. This mock records setColor/setVisible so the
  // tests assert on the surface handle rather than on the map container.
  const setColor = vi.fn();
  const setVisible = vi.fn();
  const ui = {
    uiContainer,
    colorSurface: null as null | {
      element: HTMLCanvasElement;
      setColor: typeof setColor;
      setVisible: typeof setVisible;
      register: () => void;
      unregister: () => void;
      registered: () => boolean;
      bringToFront: () => void;
      destroy: () => void;
    },
    currentColor: CONST.COLOR.DEFAULT,
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
      debouncedEnforce: vi.fn(),
      createColor: vi.fn(() => ({
        element: document.createElement("canvas"),
        setColor,
        setVisible,
        register: vi.fn(),
        unregister: vi.fn(),
        registered: vi.fn(() => true),
        bringToFront: vi.fn(),
        destroy: vi.fn(),
      })),
      map: {
        getContainer: () => document.createElement("div"),
        getPane: () => ({
          classList: { add: vi.fn(), remove: vi.fn() },
          appendChild: vi.fn(),
          style: {},
        }),
        hasLayer: vi.fn(() => true),
        removeLayer: vi.fn(),
      },
    },
  } as unknown as LayerUI;
  return { ui, setColor, setVisible };
};

describe("ui/color", () => {
  it("hideColorLayer clears the active flag on the color row", () => {
    const { ui, setVisible } = makeUi();
    showColorLayer(ui, "#ff0000");
    const colorRow = ui.uiContainer.querySelector<HTMLElement>(CONST.SEL.COLOR_ITEM);
    expect(colorRow?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);

    hideColorLayer(ui);

    expect(colorRow?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(false);
    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it("showColorLayer marks the row active and paints the color", () => {
    const { ui, setColor, setVisible } = makeUi();
    showColorLayer(ui, "#ff0000");
    expect(ui.currentColor).toBe("#ff0000");
    expect(setColor).toHaveBeenCalledWith("#ff0000");
    expect(setVisible).toHaveBeenCalledWith(true);
    const colorRow = ui.uiContainer.querySelector<HTMLElement>(CONST.SEL.COLOR_ITEM);
    expect(colorRow?.classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("showColorLayer leaves base layers on the map and the shared tilePane untouched", () => {
    // First-class basemap: colour and tiles coexist. The colour layer owns
    // its own pane — it must not remove any tile layer from the map nor
    // touch Leaflet's shared tilePane.
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
      expect(after.checked).toBe(before[i].checked);
    });
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

  it("showColorLayer reuses the surface on subsequent calls", () => {
    // The surface is created once and reused: a second show must not
    // allocate a new canvas or pane.
    const { ui, setColor } = makeUi();
    showColorLayer(ui, "#ff0000");
    const firstSurface = ui.colorSurface;
    expect(firstSurface).not.toBeNull();

    showColorLayer(ui, "#00ff00");

    expect(ui.colorSurface).toBe(firstSurface);
    expect(setColor).toHaveBeenLastCalledWith("#00ff00");
  });
});
