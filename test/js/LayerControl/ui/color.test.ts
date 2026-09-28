import { describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { hideSolidBasemap, showSolidBasemap } from "#foliplus/LayerControl/ui/color.js";
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
  colorRow.className = CONST.CLASSES.LAYER_ITEM;
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
    intentProvenance: {},
    hiddenLayerIds: new Set<string>(),
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
      enforceOrder: vi.fn(),
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
  it("hideSolidBasemap clears the surface visibility", () => {
    const { ui, setVisible } = makeUi();
    showSolidBasemap(ui, "#ff0000");

    hideSolidBasemap(ui);

    expect(setVisible).toHaveBeenCalledWith(false);
  });

  it("showSolidBasemap paints the color and shows the surface", () => {
    const { ui, setColor, setVisible } = makeUi();
    showSolidBasemap(ui, "#ff0000");
    expect(ui.currentColor).toBe("#ff0000");
    expect(setColor).toHaveBeenCalledWith("#ff0000");
    expect(setVisible).toHaveBeenCalledWith(true);
  });

  it("showSolidBasemap leaves base layers on the map and the shared tilePane untouched", () => {
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

    showSolidBasemap(ui, "#ff0000");

    expect(removeLayer).not.toHaveBeenCalled();
    expect(tilePane.classList.add).not.toHaveBeenCalled();
    expect(tilePane.classList.remove).not.toHaveBeenCalled();
  });

  it("showSolidBasemap does not repaint base rows' checkboxes or active class", () => {
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

    showSolidBasemap(ui, "#ff0000");

    rows.forEach((row, i) => {
      const after = {
        checked: row.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked,
        active: row.classList.contains(CONST.CLASSES.ACTIVE),
      };
      expect(after.checked).toBe(before[i].checked);
    });
    expect(rows[0].classList.contains(CONST.CLASSES.ACTIVE)).toBe(true);
  });

  it("showSolidBasemap tolerates a row without a checkbox (partially rendered)", () => {
    const { ui } = makeUi([{ id: "base_nochk", isBase: true }]);
    const row = ui.uiContainer.querySelector<HTMLElement>(
      `[${CONST.DATA.LAYER_ID}="base_nochk"]`,
    );
    row!.innerHTML = "";
    expect(() => showSolidBasemap(ui, "#ff0000")).not.toThrow();
  });

  it("showSolidBasemap orders the stack synchronously", () => {
    // Checking the box is a single user action: the ladder z must land
    // immediately, not after the debounce. The pane is born inside register()
    // already carrying its slot's z, so there is no 400-default window to
    // close and no provisional step left to rewrite.
    const { ui } = makeUi();
    showSolidBasemap(ui, "#ff0000");
    expect((ui.m as any).enforceOrder).toHaveBeenCalledTimes(1);
  });

  it("showSolidBasemap reuses the surface on subsequent calls", () => {
    // The surface is created once and reused: a second show must not
    // allocate a new canvas or pane.
    const { ui, setColor } = makeUi();
    showSolidBasemap(ui, "#ff0000");
    const firstSurface = ui.colorSurface;
    expect(firstSurface).not.toBeNull();

    showSolidBasemap(ui, "#00ff00");

    expect(ui.colorSurface).toBe(firstSurface);
    expect(setColor).toHaveBeenLastCalledWith("#00ff00");
  });
});
