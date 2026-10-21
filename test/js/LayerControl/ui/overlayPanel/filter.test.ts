// LayerUI filter panel (stage-2 pilot) — open/close/mutual exclusion,
// the ⋮ menu gate, slider write path (runtime store + LAYER_FILTER_CHANGE),
// and the snapshot cache the panel seeds.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { findItem, initFixture } from "../fixture.js";

/** A Marker-stamped point layer whose leaves carry `feature.properties`.
 *  `L.Marker` is the fixture's bare class; `getLatLng` and `feature` are
 *  what `buildLayerSnapshot` reads off each leaf. */
const mkPointLayer = (
  pts: Array<{ lat: number; lng: number; v: number }>,
): {
  options: Record<string, never>;
  eachLayer: (cb: (m: unknown) => void) => void;
} => {
  const markers = pts.map(p => {
    const m = new (window.L.Marker as unknown as new () => unknown)() as Record<
      string,
      unknown
    >;
    m.options = {};
    m.getLatLng = () => ({ lat: p.lat, lng: p.lng });
    m.feature = { properties: { magnitude: p.v } };
    return m;
  });
  return {
    options: {},
    eachLayer: cb => markers.forEach(cb),
  };
};

describe("LayerUI filter panel (stage-2 pilot)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: any;

  const registerPoints = (id = "pnt") => {
    manager.registerLayer({
      id,
      name: "Points",
      group: "overlay",
      layer: mkPointLayer([
        { lat: 26.08, lng: 119.3, v: 10 },
        { lat: 26.09, lng: 119.31, v: 20 },
        { lat: 26.1, lng: 119.32, v: 30 },
      ]) as L.Layer,
      styleSetters: {},
    });
    return id;
  };

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    // Folded-group state is persisted to localStorage and would leak across
    // tests — same cleanup attr.test.ts applies.
    ui.listPanel.foldedGroups = new Set();
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("the ⋮ menu gate", () => {
    it("disables the filter entry for layers without styleSetters (Heatmap rows only)", () => {
      const item = findItem(ui, "overlay1"); // registered without styleSetters
      ui.openMoreMenu(item);
      const li = item.querySelector(
        `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(li).not.toBeNull();
      expect(li.getAttribute("aria-disabled")).toBe("true");
      expect(li.hasAttribute("disabled")).toBe(true);
      expect(li.getAttribute("title")).toBe("LayerControl.filter_not_supported");
    });

    it("enables the filter entry for a layer that carries styleSetters", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openMoreMenu(item);
      const li = item.querySelector(
        `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(li.getAttribute("aria-disabled")).toBe("false");
      expect(li.hasAttribute("disabled")).toBe(false);
      expect(li.getAttribute("title")).toBe("LayerControl.filter_layer_tooltip");
    });

    it("clicking the enabled filter entry opens the panel", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openMoreMenu(item);

      const li = item.querySelector(
        `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      li.click();

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
    });
  });

  describe("openFilterPanel()", () => {
    it("renders a dialog whose title names the layer and whose label names the surface", () => {
      registerPoints();
      const item = findItem(ui, "pnt");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("dialog");
      expect(panel.getAttribute("aria-label")).toBe("LayerControl.filter_layer");
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "Points",
      );
    });

    it("renders a single-field dual-slider row bound to the first numeric field", () => {
      registerPoints();
      const item = findItem(ui, "pnt");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      // Field label and name row.
      const label = panel.querySelector(".foliplus-form-control");
      expect(label!.textContent).toBe("magnitude");
      // Both thumbs start at the snapshot's [min, max] bounds.
      const minInput = panel.querySelector(
        `.${CONST.CLASSES.FILTER_MIN}`,
      ) as HTMLInputElement;
      const maxInput = panel.querySelector(
        `.${CONST.CLASSES.FILTER_MAX}`,
      ) as HTMLInputElement;
      expect(minInput.type).toBe("range");
      expect(minInput.min).toBe("10");
      expect(minInput.max).toBe("30");
      expect(minInput.value).toBe("10");
      expect(maxInput.value).toBe("30");
      // Initial readout keeps everything.
      expect(panel.querySelector(".foliplus-filter-count")!.textContent).toBe("3 / 3");
    });

    it("renders the empty state when the layer exposes no numeric fields", () => {
      const item = findItem(ui, "overlay1"); // eachLayer yields no markers

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const empty = panel.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`);
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toBe("LayerControl.filter_empty");
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_ROW}`)).toBeNull();
    });

    it("seeds the runtime store's snapshot cache so a reopen reuses it", () => {
      registerPoints();
      const item = findItem(ui, "pnt");

      // First open builds + caches the snapshot; its range is [10, 30].
      ui.openFilterPanel(item);
      expect(ui.runtimeStore.getSnapshot("pnt")).toBeDefined();
      // Tear down, then move a marker to a lower value: a cache miss would
      // widen the bound — a cache hit keeps the original bound.
      ui.closeFilterPanel(false);
      const layer = manager.layerRegistry.get("pnt")!.layer as any;
      let first: any = null;
      layer.eachLayer((m: any) => {
        if (!first) first = m;
      });
      first.feature.properties.magnitude = 1;

      ui.openFilterPanel(item);
      const minInput = item.querySelector(
        `.${CONST.CLASSES.FILTER_MIN}`,
      ) as HTMLInputElement;
      expect(minInput.min).toBe("10");
      expect(minInput.value).toBe("10");
    });
  });

  describe("slider write path", () => {
    it("writes the between filter to the runtime store and emits LAYER_FILTER_CHANGE", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      const spy = vi.fn();
      ensureEvents(map).on(EVENTS.LAYER_FILTER_CHANGE, spy);

      const minInput = item.querySelector(
        `.${CONST.CLASSES.FILTER_MIN}`,
      ) as HTMLInputElement;
      minInput.value = "15";
      minInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Store read: the panel's own write.
      expect(ui.runtimeStore.getFilter("pnt")).toEqual({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 30],
      });
      // Bus signal so consumers (Heatmap) re-run their pipeline.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith({
        id: "pnt",
        filter: { kind: "atom", field: "magnitude", op: "between", range: [15, 30] },
      });
      // Live count readout reflects the narrower band.
      expect(item.querySelector(".foliplus-filter-count")!.textContent).toBe("2 / 3");
    });

    it("clamps out-of-range thumbs into the snapshot bounds", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      const maxInput = item.querySelector(
        `.${CONST.CLASSES.FILTER_MAX}`,
      ) as HTMLInputElement;
      maxInput.value = "100";
      maxInput.dispatchEvent(new Event("input", { bubbles: true }));

      expect(ui.runtimeStore.getFilter("pnt")).toEqual({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [10, 30],
      });
    });
  });

  describe("closeFilterPanel()", () => {
    it("header click closes the panel and returns focus to the row", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const focusSpy = vi.fn();
      item.focus = focusSpy;
      ui.openFilterPanel(item);

      item
        .querySelector(`.${CONST.CLASSES.FILTER_PANEL} .foliplus-header-title`)!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(focusSpy).toHaveBeenCalled();
    });

    it("is a no-op when no panel is open", () => {
      expect(() => ui.closeFilterPanel(false)).not.toThrow();
    });

    it("document capture mousedown outside the panel dismisses it", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();

      const wrapper = document.createElement("div");
      wrapper.addEventListener("mousedown", e => e.stopPropagation());
      const outside = document.createElement("button");
      wrapper.appendChild(outside);
      document.body.appendChild(wrapper);

      outside.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      wrapper.remove();
    });

    it("mousedown inside the panel does not dismiss it (drag verdict records)", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;

      panel.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
      expect(ui.listPanel.pressInPanel).toBe(true);

      // A press outside closes the panel and clears the verdict.
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.listPanel.pressInPanel).toBe(false);
    });

    it("a document-level mousedown (target = document) dismisses the panel", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();

      // `document` has no `closest` — the outside handler's guard branch.
      document.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    });
  });

  describe("mutual exclusion with peer overlays", () => {
    it("opening the filter panel drops an open attributes panel", () => {
      registerPoints();
      // overlay1 has no numeric fields; use it for the attrs side, then open
      // the filter on the numeric layer and assert attrs is gone.
      const attrsItem = findItem(ui, "overlay1");
      ui.openAttrsPanel(attrsItem);
      expect(attrsItem.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`)).not.toBeNull();

      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      expect(attrsItem.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`)).toBeNull();
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
    });

    it("opening the attributes panel closes the filter panel", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();

      ui.openAttrsPanel(item);

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(item.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`)).not.toBeNull();
    });
  });
});
