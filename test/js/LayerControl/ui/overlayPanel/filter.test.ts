// LayerUI filter panel (stage-2 pilot) — open/close/mutual exclusion, the
// ⋮ menu gate, and the panel's view contract over the owner capability:
// the panel reads `filterProvider` (reopen echo, result readout) and writes
// `filterSetter` through the shared Slider. The owner semantics themselves
// (validation, clamping, per-source attribution) are pinned in
// test/js/HeatmapControl/filter.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilter, type LayerFilterModel, select } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerController } from "#foliplus/LayerControl/controller.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { SLIDER } from "#common/sliderVocabulary.js";
import { findItem, initFixture } from "../fixture.js";

/** A Marker-stamped point layer whose leaves carry `feature.properties`.
 *  The values land on the row's `filterProvider` (see makeOwner below). */
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

/** A minimal filter owner with the exact same contract the Heatmap manager
 *  implements: the committed filter is the only state, `filterProvider`
 *  derives the model from it, `filterSetter` stores it. No clamping — the
 *  owner's validation rules are the Heatmap tests' job; the panel only
 *  needs a read/write pair to talk to. */
const makeOwner = (values: number[]) => {
  const range: [number, number] = [Math.min(...values), Math.max(...values)];
  const snapshot = {
    points: values.map(v => ({ lat: 0, lng: 0, fields: { magnitude: v } })),
    numericFields: ["magnitude"],
    ranges: { magnitude: range },
  };
  let filter: LayerFilter;
  return {
    filterProvider: (): LayerFilterModel => ({
      field: "magnitude",
      range,
      filter,
      kept: select(snapshot as any, filter).length,
      total: values.length,
      step: 1,
    }),
    filterSetter: (f: LayerFilter) => {
      filter = f;
    },
    get filter() {
      return filter;
    },
  };
};

/** The action names of an open ⋮ menu, in DOM order (dividers carry no
 *  data-action and drop out). */
const menuActionNames = (item: HTMLElement): string[] =>
  Array.from(
    item.querySelectorAll<HTMLElement>(".foliplus-layer-more-menu [data-action]"),
  ).map(li => li.getAttribute("data-action") ?? "");

describe("LayerUI filter panel (stage-2 pilot)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let _map: any;

  const registerPoints = (id = "pnt", owner = makeOwner([10, 20, 30])) => {
    manager.registerLayer({
      id,
      name: "Points",
      group: "overlay",
      layer: mkPointLayer([
        { lat: 26.08, lng: 119.3, v: 10 },
        { lat: 26.09, lng: 119.31, v: 20 },
        { lat: 26.1, lng: 119.32, v: 30 },
      ]) as L.Layer,
      filterProvider: owner.filterProvider,
      filterSetter: owner.filterSetter,
    });
    return { id, owner };
  };

  beforeEach(() => {
    ({ manager, ui, map: _map } = initFixture());
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
    it("hides the filter entry for layers without the filter capability", () => {
      const item = findItem(ui, "overlay1"); // registered without capability
      ui.openMoreMenu(item);
      // A control that can never run is not rendered at all — no disabled
      // row, no "not supported" tooltip sitting in every menu.
      expect(
        item.querySelector(`[data-action="${CONST.ACTION.FILTER_LAYER}"]`),
      ).toBeNull();
      // The head of the menu is then Style, still the first entry.
      expect(menuActionNames(item)[0]).toBe(CONST.ACTION.STYLE_LAYER);
    });

    it("enables the filter entry for a row that declares the capability", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openMoreMenu(item);
      const li = item.querySelector(
        `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(li.getAttribute("aria-disabled")).toBe("false");
      expect(li.hasAttribute("disabled")).toBe(false);
      expect(li.getAttribute("title")).toBe("LayerControl.filter_layer_tooltip");
      // Filter leads the supported menu; the rest keeps the reviewed order
      // (Style, Focus, Rename, Attributes, then the destructive tail).
      expect(menuActionNames(item).slice(0, 5)).toEqual([
        CONST.ACTION.FILTER_LAYER,
        CONST.ACTION.STYLE_LAYER,
        "focus-layer",
        CONST.ACTION.RENAME_LAYER,
        CONST.ACTION.ATTRS_LAYER,
      ]);
    });

    it("does not infer the capability from styleSetters (the Measure case)", () => {
      // MeasureControl rows carry styleProvider/styleSetters for the style
      // drawer — that is not a filter capability.
      manager.registerLayer({
        id: "measureRow",
        name: "Measure",
        group: "overlay",
        layer: undefined as unknown as L.Layer,
        styleProvider: () => ({}),
        styleSetters: {},
      });
      const item = findItem(ui, "measureRow");
      ui.openMoreMenu(item);
      expect(
        item.querySelector(`[data-action="${CONST.ACTION.FILTER_LAYER}"]`),
      ).toBeNull();
    });

    it("rejects a truthy non-function capability (untyped caller)", () => {
      // A JS caller can pass any truthy value. The menu and the panel share
      // one predicate, so a value the panel cannot call never renders an
      // enabled entry that opens to an empty panel.
      manager.registerLayer({
        id: "bogus",
        name: "Bogus",
        group: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: "yes" as unknown as () => LayerFilterModel,
        filterSetter: {} as unknown as (filter: LayerFilter) => void,
      });
      const item = findItem(ui, "bogus");
      ui.openMoreMenu(item);
      expect(
        item.querySelector(`[data-action="${CONST.ACTION.FILTER_LAYER}"]`),
      ).toBeNull();
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

    it("falls back to the menu item when the active menu state is lost", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openMoreMenu(item);
      const spy = vi.spyOn(ui, "openFilterPanel");

      // Menu state dropped (e.g. a peer overlay cleared it) — the handler
      // must still dispatch, anchoring on the clicked <li>.
      ui.overlayPanel.activeMenu = null;
      const li = item.querySelector(
        `[data-action="${CONST.ACTION.FILTER_LAYER}"]`,
      ) as HTMLElement;
      expect(() => li.click()).not.toThrow();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
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

    it("renders field / range / result form rows with the shared dual-thumb slider", () => {
      registerPoints();
      const item = findItem(ui, "pnt");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      // Field row: label + the owner's field name.
      const field = panel.querySelector(`.${CONST.CLASSES.FILTER_FIELD}`);
      expect(field!.textContent).toBe("magnitude");
      // Range row: the shared Slider — two real thumbs, not stacked range
      // inputs, both parked at the full extent for "no filter".
      const host = panel.querySelector(
        `.${CONST.CLASSES.FILTER_SLIDER}`,
      ) as HTMLElement;
      const thumbs = host.querySelectorAll(`.${SLIDER.THUMB}`);
      expect(thumbs).toHaveLength(2);
      expect(panel.querySelector("input[type=range]")).toBeNull();
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
      // Result row: a live region fed by the owner model.
      const result = panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`);
      expect(result!.getAttribute("aria-live")).toBe("polite");
    });

    it("the result readout composes the localized kept/total sentence", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      owner.filterSetter({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [10, 20],
      });
      const spy = vi
        .spyOn(ui, "T")
        .mockImplementation(
          key =>
            (key === "filter_result"
              ? "{kept} of {total}"
              : `LayerControl.${key}`) as any,
        );

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!.textContent).toBe(
        "2 of 3",
      );
      spy.mockRestore();
    });

    it("echoes the committed filter on reopen (slider value, not the full extent)", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      // The user filtered, closed, reopens: the slider must show the
      // committed band, and the result must match what the map shows.
      owner.filterSetter({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 25],
      });

      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const thumbs = host.querySelectorAll(`.${SLIDER.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("15");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("25");
    });

    it("renders the empty state when the row has no filterable model", () => {
      const item = findItem(ui, "overlay1"); // registered without capability

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const empty = panel.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`);
      expect(empty).not.toBeNull();
      expect(empty!.textContent).toBe("LayerControl.filter_empty");
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).toBeNull();
    });

    it("renders the empty state when the owner reports no model", () => {
      // Capability declared, but the owner says "nothing filterable" (no
      // source selected / no numeric field on the heatmap side).
      manager.registerLayer({
        id: "hm",
        name: "Heatmap",
        group: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: () => null,
        filterSetter: () => {},
      });
      const item = findItem(ui, "hm");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`)).not.toBeNull();
    });

    it("is a no-op for a row that lost its data-layer-id", () => {
      const item = findItem(ui, "overlay1");
      item.removeAttribute(CONST.DATA.LAYER_ID);

      expect(() => ui.openFilterPanel(item)).not.toThrow();
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    });

    it("disables the slider for a constant field (zero-width extent)", () => {
      registerPoints("flat", makeOwner([10, 10]));
      const item = findItem(ui, "flat");

      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      expect(host.classList.contains(SLIDER.DISABLED)).toBe(true);
      const thumb = host.querySelector(`.${SLIDER.THUMB}`) as HTMLElement;
      expect(thumb.getAttribute("aria-disabled")).toBe("true");
    });

    it("falls back to the layer id when the display name is empty", async () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const rowView = await import("#foliplus/LayerControl/ui/listPanel/rowView.js");
      const spy = vi.spyOn(rowView, "displayName").mockReturnValue("");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "pnt",
      );
      spy.mockRestore();
    });
  });

  describe("slider write path (through the owner capability)", () => {
    /** The slider.test.ts pointer recipe: jsdom reports 0×0 rects, the
     *  pointer paths need a rail with a measurable box. */
    const stubTrack = (host: HTMLElement): HTMLElement => {
      const track = host.querySelector(`.${SLIDER.TRACK}`) as HTMLElement;
      track.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 100,
          height: 14,
          right: 100,
          bottom: 14,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      return track;
    };

    const pointer = (type: string, clientX: number): MouseEvent =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 7,
        button: 0,
      } as MouseEventInit);

    it("a pointer drag writes the band through filterSetter and publishes the id-only signal", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const track = stubTrack(host);
      // Drag the lower thumb to ~15 (rail 0..100 over extent 10..30).
      track.dispatchEvent(pointer("pointerdown", 25));
      track.dispatchEvent(pointer("pointermove", 25));
      track.dispatchEvent(pointer("pointerup", 25));

      expect(owner.filter).toEqual({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 30],
      });
      // (The owner's LAYER_FILTER_CHANGE publish is the Heatmap owner
      // tests' assertion; this stub stores silently.)
    });

    it("a pointer write refreshes the live kept/total readout", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      const spy = vi
        .spyOn(ui, "T")
        .mockImplementation(
          key =>
            (key === "filter_result"
              ? "{kept} of {total}"
              : `LayerControl.${key}`) as any,
        );
      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const result = panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!;
      expect(result.textContent).toBe("3 of 3");

      const host = panel.querySelector(
        `.${CONST.CLASSES.FILTER_SLIDER}`,
      ) as HTMLElement;
      const track = stubTrack(host);
      track.dispatchEvent(pointer("pointerdown", 25));
      track.dispatchEvent(pointer("pointermove", 25));
      track.dispatchEvent(pointer("pointerup", 25));

      // The map already shows 2 points; the live region must not keep
      // announcing the pre-drag count.
      expect(owner.filter).toBeDefined();
      expect(result.textContent).toBe("2 of 3");
      spy.mockRestore();
    });

    it("the keyboard moves a thumb and writes through the same setter", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const maxThumb = host.querySelectorAll(`.${SLIDER.THUMB}`)[1];
      maxThumb.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(owner.filter).toEqual({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [10, 29],
      });
    });

    it("a keyboard write refreshes the live kept/total readout", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const spy = vi
        .spyOn(ui, "T")
        .mockImplementation(
          key =>
            (key === "filter_result"
              ? "{kept} of {total}"
              : `LayerControl.${key}`) as any,
        );
      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const host = panel.querySelector(
        `.${CONST.CLASSES.FILTER_SLIDER}`,
      ) as HTMLElement;
      host.querySelectorAll(`.${SLIDER.THUMB}`)[1].dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowLeft",
          bubbles: true,
          cancelable: true,
        }),
      );

      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!.textContent).toBe(
        "2 of 3",
      );
      spy.mockRestore();
    });

    it("the Clear footer writes undefined and pulls the slider back to the extent", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      owner.filterSetter({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 25],
      });
      ui.openFilterPanel(item);

      const clearBtn = item.querySelector(
        `.${CONST.CLASSES.FILTER_CLEAR}`,
      ) as HTMLButtonElement;
      clearBtn.click();

      expect(owner.filter).toBeUndefined();
      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const thumbs = host.querySelectorAll(`.${SLIDER.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
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
      // overlay1 has no capability; use it for the attrs side, then open
      // the filter on the capable layer and assert attrs is gone.
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

  describe("owner signals while the panel is open", () => {
    it("an external filter change refreshes the band and the live readout", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      const spy = vi
        .spyOn(ui, "T")
        .mockImplementation(
          key =>
            (key === "filter_result"
              ? "{kept} of {total}"
              : `LayerControl.${key}`) as any,
        );
      ui.openFilterPanel(item);

      // Another capability caller (or the owner's own content revalidation)
      // commits a band; the panel did not write it, so it must pull the model.
      owner.filterSetter({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 25],
      });
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const thumbs = panel.querySelectorAll(`.${SLIDER.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("15");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("25");
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!.textContent).toBe(
        "1 of 3",
      );
      spy.mockRestore();
    });

    it("an external clear pulls the slider back to the full extent", () => {
      const { owner } = registerPoints();
      const item = findItem(ui, "pnt");
      owner.filterSetter({
        kind: "atom",
        field: "magnitude",
        op: "between",
        range: [15, 25],
      });
      ui.openFilterPanel(item);
      expect(
        (item.querySelectorAll(`.${SLIDER.THUMB}`)[0] as HTMLElement).getAttribute(
          "aria-valuenow",
        ),
      ).toBe("15");

      // The owner retired the filter on its own (source reset, content
      // revalidation, the more-menu clear).
      owner.filterSetter(undefined);
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

      const thumbs = item.querySelectorAll(`.${SLIDER.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
    });

    it("a same-id replacement closes the panel and retires the old setter", () => {
      const oldOwner = makeOwner([10, 20, 30]);
      const oldSetter = vi.spyOn(oldOwner, "filterSetter");
      registerPoints("pnt", oldOwner);
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      const staleThumb = item.querySelectorAll(`.${SLIDER.THUMB}`)[0];

      // The entry under the same id is swapped (re-registration): the panel's
      // identity is the entry it opened against, so this must close rather
      // than keep writing the retired owner.
      const newOwner = makeOwner([100, 200, 300]);
      const newSetter = vi.spyOn(newOwner, "filterSetter");
      manager.registerLayer({
        id: "pnt",
        name: "Points",
        group: "overlay",
        layer: mkPointLayer([
          { lat: 26.08, lng: 119.3, v: 100 },
          { lat: 26.09, lng: 119.31, v: 200 },
          { lat: 26.1, lng: 119.32, v: 300 },
        ]) as L.Layer,
        filterProvider: newOwner.filterProvider,
        filterSetter: newOwner.filterSetter,
      });

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();

      // A keyboard event on the detached thumb must not resurrect the write:
      // the capability is re-resolved by id, and the entry no longer matches.
      staleThumb.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowRight",
          bubbles: true,
          cancelable: true,
        }),
      );
      expect(oldSetter).not.toHaveBeenCalled();
      expect(newSetter).not.toHaveBeenCalled();
      oldSetter.mockRestore();
      newSetter.mockRestore();
    });
    it("closes when the row is unregistered (capability gone)", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      manager.unregisterLayer("pnt");

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      expect(ui.overlayPanel.filterOutsideHandler).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();
    });
  });

  describe("teardown", () => {
    it("unbindEvents closes the filter panel and releases its document listener", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
      expect(ui.overlayPanel.filterOutsideHandler).not.toBeNull();

      ui.unbindEvents();

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      expect(ui.overlayPanel.filterOutsideHandler).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();
    });

    it("unbindEvents closes an open attributes panel too", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      expect(ui.overlayPanel.activeAttrsPanel).not.toBeNull();

      ui.unbindEvents();

      expect(item.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
      expect(ui.overlayPanel.attrsOutsideHandler).toBeNull();
    });
  });
});

// ── Result / Clear / keyboard / row state (first batch of the #724 review) ──
describe("LayerUI filter panel — result, Clear and row state", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const registerPoints = (id = "pnt", sourceId?: string) => {
    const values = [10, 20, 30];
    const range: [number, number] = [10, 30];
    const snapshot = {
      points: values.map(v => ({ lat: 0, lng: 0, fields: { magnitude: v } })),
      numericFields: ["magnitude"],
      ranges: { magnitude: range },
    };
    let filter: LayerFilter;
    const owner = {
      filterProvider: (): LayerFilterModel => ({
        sourceId,
        field: "magnitude",
        range,
        filter,
        kept: select(snapshot as any, filter).length,
        total: values.length,
        step: 1,
      }),
      filterSetter: (f: LayerFilter) => {
        filter = f;
      },
      get filter() {
        return filter;
      },
    };
    manager.registerLayer({
      id,
      name: "Points",
      group: "overlay",
      layer: {
        options: {},
        eachLayer: vi.fn(),
      } as unknown as L.Layer,
      filterProvider: owner.filterProvider,
      filterSetter: owner.filterSetter,
    });
    return { id, owner };
  };

  const commit = (owner: { filterSetter: (f: LayerFilter) => void }) =>
    owner.filterSetter({
      kind: "atom",
      field: "magnitude",
      op: "between",
      range: [10, 20],
    });

  beforeEach(() => {
    ({ manager, ui } = initFixture());
    ui.listPanel.foldedGroups = new Set();
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("the result row is one sentence: percent first, then exact kept / total", () => {
    const { owner } = registerPoints();
    commit(owner);
    const spy = vi
      .spyOn(ui, "T")
      .mockImplementation(
        key =>
          (key === "filter_result"
            ? "{pct}% ({kept} of {total}) kept"
            : `LayerControl.${key}`) as any,
      );

    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    const result = panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!;
    expect(result.textContent).toBe("67% (2 of 3) kept");
    // A standard FORM_ROW: right-aligned Result label + one control cell.
    const row = result.closest(`.${CONST.CLASSES.FORM_ROW}`) as HTMLElement;
    expect(row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent).toBe(
      "LayerControl.filter_result_label",
    );
    // No second ratio / progress track anywhere in the panel.
    expect(panel.querySelectorAll(`.${CONST.CLASSES.FILTER_RESULT}`)).toHaveLength(1);
    expect(panel.querySelector('[role="progressbar"]')).toBeNull();
    expect(panel.querySelector(".foliplus-filter-ratio")).toBeNull();
    spy.mockRestore();
  });

  it("Clear is the only footer action and is disabled until a filter exists", () => {
    const { owner } = registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    const buttons = panel.querySelectorAll(".foliplus-btn-row button");
    expect(buttons).toHaveLength(1);
    const clear = buttons[0] as HTMLButtonElement;
    expect(clear.classList.contains(CONST.CLASSES.FILTER_CLEAR)).toBe(true);
    expect(clear.disabled).toBe(true);
    expect(clear.getAttribute("aria-disabled")).toBe("true");

    // The owner commits outside the panel (e.g. a source switch): the live
    // view follows, and Clear becomes the actionable reset.
    commit(owner);
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });
    expect(clear.disabled).toBe(false);
    expect(clear.getAttribute("aria-disabled")).toBe("false");
    clear.click();
    expect(owner.filter).toBeUndefined();
  });

  it("Escape closes the live panel (no Done / Apply step)", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();

    ui.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("the row shows a 12px funnel + exact kept count + filtered title", () => {
    const { owner } = registerPoints();
    commit(owner);
    const spy = vi.spyOn(ui, "T").mockImplementation(key => {
      if (key === "filter_row_title") return "{kept} / {total} filtered · {type}";
      // Row tooltips use the short word; the attrs/type label stays long.
      if (key.endsWith("_short")) return "Point";
      if (key.startsWith("type_")) return "Point Layer";
      return `LayerControl.${key}` as any;
    });

    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    const item = findItem(ui, "pnt");
    const count = item.querySelector(`.${CONST.CLASSES.COUNT_COL}`) as HTMLElement;
    expect(count.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(true);
    const funnel = count.querySelector(`.${CONST.CLASSES.COUNT_FUNNEL}`) as HTMLElement;
    expect(funnel).not.toBeNull();
    expect(funnel.querySelector("svg")).not.toBeNull();
    // Exact count, not the compact form: 2,500 beats 2.5K on a filtered row.
    // Read the value span (the funnel SVG source contributes whitespace text).
    expect(count.querySelector(".foliplus-layer-count-value")!.textContent).toBe("2");
    // Hover title: kept / total filtered · short type — no layer name, and
    // never the attrs panel's long "Point Layer" wording.
    expect(item.title).toBe("2 / 3 filtered · Point");
    expect(item.title).not.toContain("Point Layer");
    expect(count.title).toBe("2 / 3 filtered · Point");
    expect(count.getAttribute("aria-label")).toBe("2 / 3 filtered · Point");
    // The persisted type label (DATA.TITLE) keeps the long form.
    expect(item.getAttribute(CONST.DATA.TITLE)).toBe("Point Layer");

    // Clearing the filter takes the funnel and the accent away; the count
    // returns to the plain (compact-capable) projection.
    owner.filterSetter(undefined);
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });
    const cleared = findItem(ui, "pnt");
    const plain = cleared.querySelector(`.${CONST.CLASSES.COUNT_COL}`) as HTMLElement;
    expect(plain.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(false);
    expect(plain.querySelector(`.${CONST.CLASSES.COUNT_FUNNEL}`)).toBeNull();
    expect(plain.title).toBe("");
    // Unfiltered tooltip also uses the short type word.
    expect(cleared.title).toBe("0 · Point");
    spy.mockRestore();
  });

  it("paints the funnel on the owner's source row, not its capability row", () => {
    // Heatmap shape: the capability lives on one row ("pnt"), the filtered
    // records belong to another ("src"). The data row owns the funnel and
    // the tooltip type; the capability row stays a normal row.
    const { owner } = registerPoints("pnt", "src");
    manager.registerLayer({
      id: "src",
      name: "Source",
      group: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
    });
    commit(owner);
    const spy = vi.spyOn(ui, "T").mockImplementation(key => {
      if (key === "filter_row_title") return "{kept} / {total} filtered · {type}";
      if (key.startsWith("type_")) return "Point";
      return `LayerControl.${key}` as any;
    });

    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    const dataCount = findItem(ui, "src").querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    expect(dataCount.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(true);
    expect(dataCount.querySelector(".foliplus-layer-count-value")!.textContent).toBe(
      "2",
    );
    expect(findItem(ui, "src").title).toBe("2 / 3 filtered · Point");
    // The capability row itself shows no filter decoration (it is not the
    // data row; its own count is the canvas feature count).
    const capCount = findItem(ui, "pnt").querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    expect(capCount.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(false);
    spy.mockRestore();
  });
});
