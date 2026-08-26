import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { LayerManager } from "#foliplus/LayerControl/manager.js";
import { LayerUI } from "#foliplus/LayerControl/ui.js";

class TileLayer {
  options = { attribution: "© OpenStreetMap" };
  setZIndex = vi.fn();
}

class GridLayer {
  options = {};
}

const makePane = () => {
  const el = document.createElement("div");
  el.style.zIndex = "0";
  return el;
};

const initFixture = (options: {
  initialZoom?: number;
  maxZoom?: number;
} = {}): { manager: LayerManager; ui: LayerUI; map: any } => {
  vi.stubGlobal("CONF", {
    ...window.CONF,
    name: "LayerControl",
    locale_code: "en",
  });

  class Renderer {}
  class Path {
    options = {};
  }
  class Polygon {
    options = {};
  }
  class Polyline {
    options = {};
  }
  class Marker {}
  class CircleMarker {}
  const stamp = (() => {
    let id = 0;
    return vi.fn(() => ++id);
  })();

  window.L.TileLayer = TileLayer;
  window.L.GridLayer = GridLayer;
  window.L.Renderer = Renderer;
  window.L.layerGroup = vi.fn(() => ({
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    hasLayer: vi.fn(() => false),
    getLayers: vi.fn(() => []),
    clearLayers: vi.fn(),
    options: {},
  }));
  window.L.Path = Path;
  window.L.Polygon = Polygon;
  window.L.Polyline = Polyline;
  window.L.Marker = Marker;
  window.L.CircleMarker = CircleMarker;
  window.L.stamp = stamp;
  window.L.svg = vi.fn(() => ({ addTo: vi.fn() }));
  window.L.rectangle = vi.fn((_bounds: any, opts: any) =>
    ({
      _options: opts,
      getClassName: () => opts?.className ?? "",
      on: vi.fn(),
      eachLayer: vi.fn(),
    }) as any,
  );

  const container = document.createElement("div");
  document.body.appendChild(container);

  const sw = { lat: 30, lng: 100 };
  const ne = { lat: 40, lng: 110 };
  const bounds = {
    isValid: vi.fn(() => true),
    getSouthWest: () => sw,
    getNorthEast: () => ne,
  };

  const polygonLayer = {
    options: {},
    eachLayer: vi.fn(),
    getBounds: vi.fn(() => bounds),
  };

  const map: any = {
    on: vi.fn(),
    off: vi.fn(),
    invalidateSize: vi.fn(),
    hasLayer: vi.fn(() => true),
    addLayer: vi.fn(),
    removeLayer: vi.fn(),
    fitBounds: vi.fn(),
    getZoom: vi.fn(() => options.initialZoom ?? 5),
    getMaxZoom: vi.fn(() => options.maxZoom ?? 18),
    getContainer: vi.fn(() => container),
    getPane: vi.fn(() => {
      const p = makePane();
      p.style.zIndex = "0";
      return p;
    }),
    createPane: vi.fn(() => {
      const p = makePane();
      p.classList.add("foliplus-layer-pane");
      return p;
    }),
    _container: container,
    _layers: {},
    attributionControl: { _attributions: {}, _update: vi.fn() },
    foliplus: {
      showHint: vi.fn(),
      hideHint: vi.fn(),
    },
  };

  const manager = new LayerManager(map, [
    { id: "overlay1", name: "Polygons", isBase: false, layer: polygonLayer },
    {
      id: "base1",
      name: "OSM",
      isBase: true,
      layer: new TileLayer(),
      paneName: "tilePane",
    },
  ]);
  manager.enforceOrder();
  manager.ui = new LayerUI(manager);

  // Switch to fake timers BEFORE attachUI so the 300ms initTypesAndVisibility
  // timeout from attachUI is controllable. If the timer were REAL and
  // advanceTimersByTime didn't flush it, the callback would fire after
  // afterEach clears the DOM and throw on the detached container.
  vi.useFakeTimers();

  manager.attachUI(container);
  const ui = manager.ui!;

  vi.advanceTimersByTime(350);
  vi.useRealTimers();

  return { manager, ui, map };
}

const findItem = (ui: LayerUI, id: string): HTMLElement =>
  ui.uiContainer.querySelector(
    `[${CONST.DATA.LAYER_ID}="${id}"]`,
  ) as HTMLElement;

// ===========================================================================
describe("LayerUI focusLayer / openMoreMenu / closeMoreMenu", () => {
  let manager: LayerManager, ui: LayerUI, map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ─────────────────── focusLayer() ───────────────────

  describe("focusLayer()", () => {
    it("draws a pulsing rectangle on the layer bounds", () => {
      ui.focusLayer("overlay1");

      expect(L.rectangle).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          className: "foliplus-focus-rect",
          fillOpacity: 0,
          interactive: false,
        }),
      );
      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          _options: expect.objectContaining({
            className: "foliplus-focus-rect",
          }),
        }),
      );
    });

    it("passes the correct bounds object to L.rectangle", () => {
      ui.focusLayer("overlay1");

      expect(L.rectangle).toHaveBeenCalledWith(
        expect.objectContaining({
          getSouthWest: expect.any(Function),
          getNorthEast: expect.any(Function),
          isValid: expect.any(Function),
        }),
        expect.anything(),
      );
    });

    it("calls fitBounds with smooth animation options", () => {
      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          animate: true,
          duration: 0.6,
          padding: [40, 40],
        }),
      );
    });

    it("caps maxZoom at current zoom + 4", () => {
      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: 9 }), // zoom(5) + 4
      );
    });

    it("caps maxZoom at map.getMaxZoom() when current + 4 exceeds it", () => {
      ({ manager, ui, map } = initFixture({ initialZoom: 17, maxZoom: 18 }));

      ui.focusLayer("overlay1");

      expect(map.fitBounds).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxZoom: 18 }), // min(18, 17 + 4)
      );
    });

    it("adds the layer to the map if checkbox is checked but layer is off map", () => {
      map.hasLayer.mockReturnValue(false);

      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = true;

      ui.focusLayer("overlay1");

      expect(map.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ getBounds: expect.any(Function) }),
      );
    });

    it("does not re-add the layer when it is already on the map", () => {
      map.hasLayer.mockReturnValue(true);
      map.addLayer.mockReset();

      ui.focusLayer("overlay1");

      // addLayer may be called for the rectangle overlay, but NOT for the
      // layer itself (already on the map).
      const layerArgs = map.addLayer.mock.calls.map(c => c[0]).filter(
        (arg: any) => arg && typeof arg.getBounds === "function",
      );
      expect(layerArgs.length).toBe(0);
    });

    it("bails out when bounds are invalid", () => {
      const layer = manager.findLayer(manager.layerRegistry.get("overlay1")!);
      // @ts-expect-error — override mocked getBounds
      layer.getBounds.mockImplementationOnce(() => ({ isValid: () => false }));

      ui.focusLayer("overlay1");

      expect(L.rectangle).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("bails out when the layer is not found on the map", () => {
      vi.spyOn(manager, "findLayer").mockReturnValue(null);

      ui.focusLayer("overlay1");

      expect(L.rectangle).not.toHaveBeenCalled();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("bails out for a non-existent layer id without error", () => {
      expect(() => ui.focusLayer("nonexistent")).not.toThrow();
      expect(map.fitBounds).not.toHaveBeenCalled();
    });

    it("shows a hint when the layer is hidden (checkbox unchecked)", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      // ensureEvents() wipes map.foliplus.showHint; re-attach a spy.
      const hintSpy = vi.fn();
      map.foliplus.showHint = hintSpy;

      ui.focusLayer("overlay1");

      expect(hintSpy).toHaveBeenCalledWith(
        "LayerControl",
        "LayerControl.focus_layer_hidden",
        expect.any(Number),
      );
      expect(map.fitBounds).not.toHaveBeenCalled();
      expect(L.rectangle).not.toHaveBeenCalled();
    });

    it("removes the previous focus rectangle before drawing a new one", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const firstRect = ui.focusRect!;

      ui.focusLayer("overlay1");

      expect(map.removeLayer).toHaveBeenCalledWith(firstRect);
      expect(ui.focusRect).not.toBeNull();
      expect(ui.focusRect).not.toBe(firstRect);
    });

    it("removes the focus rectangle after 5 seconds", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;

      vi.advanceTimersByTime(4999);
      expect(map.removeLayer).not.toHaveBeenCalledWith(rect);

      vi.advanceTimersByTime(1);
      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });

    it("does not remove a replaced focus rectangle at the 5s timeout", () => {
      vi.useFakeTimers();

      ui.focusLayer("overlay1");
      ui.focusLayer("overlay1");
      const finalRect = ui.focusRect!;
      // The first rect was removed synchronously; the second's 5s timer
      // should only remove `finalRect`.
      vi.advanceTimersByTime(5001);

      expect(map.removeLayer).toHaveBeenCalledWith(finalRect);
    });
  });

  // ─────────────────── overflow menu ───────────────────

  describe("openMoreMenu() / closeMoreMenu()", () => {
    it("creates a menu with the focus-layer action", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      );
      expect(li).not.toBeNull();
      expect(li?.getAttribute("role")).toBe("menuitem");
      expect(li?.getAttribute("tabindex")).toBe("0");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("places the menu inside the layer row element", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("sets position:relative on the layer row", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);

      expect(item.style.position).toBe("relative");
    });

    it("closes the previously open menu before opening a new one", () => {
      const item = findItem(ui, "overlay1");

      ui.openMoreMenu(item);
      ui.openMoreMenu(item);

      // Only one menu at a time — the new one replaced the old.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(ui.activeMenu).not.toBeNull();
    });

    it("closeMoreMenu(setFocus=true) returns focus to the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(true);

      expect(focusSpy).toHaveBeenCalled();
    });

    it("closeMoreMenu(setFocus=false) does not focus the layer row", () => {
      const item = findItem(ui, "overlay1");
      const focusSpy = vi.fn();
      item.focus = focusSpy;

      ui.openMoreMenu(item);
      ui.closeMoreMenu(false);

      expect(focusSpy).not.toHaveBeenCalled();
    });

    it("closeMoreMenu() is a no-op when no menu is open", () => {
      expect(() => ui.closeMoreMenu(false)).not.toThrow();
    });
  });

  // ─────────────────── more button visibility ───────────────────

  describe("more button visibility", () => {
    it("base layer more button is hidden", () => {
      const baseItem = findItem(ui, "base1");
      const btn = baseItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBe("hidden");
    });

    it("overlay layer more button is visible", () => {
      const overlayItem = findItem(ui, "overlay1");
      const btn = overlayItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute("hidden")).toBeNull();
    });

    it("color layer has no more button", () => {
      const colorItem = ui.uiContainer.querySelector(
        `${CONST.SEL.COLOR_ITEM}`,
      )!;
      const btn = colorItem.querySelector(`.${CONST.CLASSES.MORE_BTN}`);
      expect(btn).toBeNull();
    });
  });

  // ─────────────────── hidden layer disables focus menu item ───────────────────

  describe("focus-layer menu item when layer is hidden", () => {
    it("marks the menu item disabled when checkbox is unchecked", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li).not.toBeNull();
      expect(li?.getAttribute("disabled")).toBe("disabled");
      expect(li?.getAttribute("title")).toBeDefined();
    });

    it("clicking the disabled menu item does not call focusLayer", () => {
      const checkbox = findItem(ui, "overlay1").querySelector(
        'input[type="checkbox"]',
      ) as HTMLInputElement;
      if (checkbox) checkbox.checked = false;

      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const focusSpy = vi.fn();
      ui.focusLayer = focusSpy;

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement;
      li.click();

      expect(focusSpy).not.toHaveBeenCalled();
      // Menu stays open — user sees the disabled state and tooltip.
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
    });

    it("menu item is not disabled when layer is visible", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        ".foliplus-layer-more-menu li[data-action='focus-layer']",
      ) as HTMLElement | null;
      expect(li?.getAttribute("disabled")).toBeNull();
    });
  });

  // ─────────────────── keyboard on more button ───────────────────

  describe("more button keyboard shortcut", () => {
    it("Enter on more button opens the menu instead of toggling the checkbox", () => {
      const btn = findItem(ui, "overlay1").querySelector(
        `.${CONST.CLASSES.MORE_BTN}`,
      )!;
      const item = findItem(ui, "overlay1");

      // Spy on checkbox dispatchEvent to prove toggle wasn't triggered.
      const origDispatchEvent = HTMLInputElement.prototype.dispatchEvent;
      const toggleSpy = vi.fn();
      HTMLInputElement.prototype.dispatchEvent = function (...args: any[]) {
        const ev = args[0] as Event;
        if (ev.type === "change") toggleSpy();
        return origDispatchEvent.apply(this, args);
      };

      // Focus the more button so document.activeElement is inside the
      // uiContainer and the Enter/Space shortcut fires. `handleKeyDown`
      // short-circuits on MORE_BTN without calling toggleFocusedLayer.
      btn.focus();
      expect(document.activeElement).toBe(btn);

      const event = new KeyboardEvent("Enter", { bubbles: true, cancelable: true });
      ui.handleKeyDown(event as unknown as KeyboardEvent);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);
      expect(toggleSpy).not.toHaveBeenCalled();

      HTMLInputElement.prototype.dispatchEvent = origDispatchEvent;
    });
  });

  // ─────────────────── destroy ───────────────────

  describe("destroy()", () => {
    it("removes the active focus rectangle", () => {
      vi.useFakeTimers();
      ui.focusLayer("overlay1");
      const rect = ui.focusRect!;

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
    });

    it("removes the active overflow menu", () => {
      const item = findItem(ui, "overlay1");
      ui.openMoreMenu(item);

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(1);

      manager.destroy();

      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });

    it("removes both focus rectangle and active menu simultaneously", () => {
      vi.useFakeTimers();

      const item = findItem(ui, "overlay1");
      ui.focusLayer("overlay1");
      ui.openMoreMenu(item);

      const rect = ui.focusRect!;

      manager.destroy();

      expect(map.removeLayer).toHaveBeenCalledWith(rect);
      expect(ui.focusRect).toBeNull();
      expect(item.querySelectorAll(".foliplus-layer-more-menu").length).toBe(0);
    });
  });
});