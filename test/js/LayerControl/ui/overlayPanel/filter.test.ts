// LayerUI filter panel — open/close/mutual exclusion, the
// ⋮ menu gate, and the panel's view contract over the owner capability:
// the panel reads `filterProvider` (reopen echo, result readout) and writes
// `filterSetter` through the shared Slider. The owner semantics themselves
// (validation, clamping, per-source attribution) are pinned in
// test/js/HeatmapControl/filter.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilter, type LayerFilterModel, select } from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlayRegistry.js";
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
      dimensions: [
        {
          kind: "range",
          field: "magnitude",
          label: "magnitude",
          range,
          step: 1,
        },
      ],
      filter,
      kept: select(snapshot as any, filter).length,
      total: values.length,
    }),
    filterSetter: (f: LayerFilter) => {
      filter = f;
    },
    get filter() {
      return filter;
    },
  };
};

/** A minimal enum filter owner: one Type dimension, the committed filter as
 *  its only state. The caller may hold the `values` array and mutate it to
 *  model measurements appearing/disappearing; the provider rebuilds the option
 *  list on every read. Kept counts two records per selected type so the
 *  readout proves it re-reads the owner rather than a local selection count. */
const makeEnumOwner = (
  values: string[] = ["marker", "distance", "polygon", "circle"],
  initial?: LayerFilter,
) => {
  let filter: LayerFilter | undefined = initial;
  return {
    filterProvider: (): LayerFilterModel => {
      const options = values.map(value => ({
        value,
        label: value.toUpperCase(),
      }));
      const committed = filter;
      const selected =
        committed?.kind === "enum"
          ? options.filter(option => committed.values.includes(option.value)).length
          : options.length;
      return {
        dimensions: [
          { kind: "enum", field: "type", label: "Type", multi: true, options },
        ],
        filter,
        kept: selected * 2,
        total: options.length * 2,
      };
    },
    filterSetter: (next: LayerFilter) => {
      filter = next;
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

describe("LayerUI filter panel", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let _map: any;

  const registerPoints = (id = "pnt", owner = makeOwner([10, 20, 30])) => {
    manager.registerLayer({
      id,
      name: "Points",
      role: "overlay",
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
    ui.listPanel.foldedRoles = new Set();
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
        role: "overlay",
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
        role: "overlay",
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
      // Field row: the dimension label sits in the label cell and the control
      // cell holds the slider, so the owner's field name is not repeated.
      const field = panel.querySelector(
        `.${CONST.CLASSES.FILTER_FIELD}`,
      ) as HTMLElement;
      expect(field.textContent).toBe("");
      const row = field.closest(`.${CONST.CLASSES.FORM_ROW}`) as HTMLElement;
      expect(row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent).toBe(
        "magnitude",
      );
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
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: () => null,
        filterSetter: () => {},
      });
      const item = findItem(ui, "hm");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`)).not.toBeNull();
    });

    it("renders the shared dropdown for an enum dimension", () => {
      // A generic owner may expose an enum dimension. It gets the enum body,
      // not the range body or the "nothing filterable" fallback, and the body
      // is the one shared primitive — never a hand-rolled listbox.
      const owner = makeEnumOwner();
      manager.registerLayer({
        id: "enum-owner",
        name: "Enum owner",
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: owner.filterProvider,
        filterSetter: owner.filterSetter,
      });
      const item = findItem(ui, "enum-owner");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`)).toBeNull();
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).toBeNull();
      expect(panel.querySelector("select")).toBeNull();
      const enumCell = panel.querySelector(
        `.${CONST.CLASSES.FILTER_ENUM}`,
      ) as HTMLElement;
      expect(
        enumCell
          .querySelector(".foliplus-dropdown-trigger")
          ?.getAttribute("aria-haspopup"),
      ).toBe("listbox");
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

  describe("enum body", () => {
    const registerEnum = (
      owner = makeEnumOwner(),
      id = "measure",
    ): { id: string; owner: ReturnType<typeof makeEnumOwner>; item: HTMLElement } => {
      manager.registerLayer({
        id,
        name: "Measure",
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: owner.filterProvider,
        filterSetter: owner.filterSetter,
      });
      return { id, owner, item: findItem(ui, id) };
    };

    const triggerOf = (item: HTMLElement): HTMLButtonElement =>
      item.querySelector(
        `.${CONST.CLASSES.FILTER_ENUM} .foliplus-dropdown-trigger`,
      ) as HTMLButtonElement;
    const labelOf = (item: HTMLElement): string =>
      triggerOf(item).querySelector(".foliplus-dropdown-label")?.textContent ?? "";
    /** The open popup is portalled out of the panel (common/dropdown), so it is
     *  queried from the document rather than from the row. */
    const listOf = (): HTMLElement | null =>
      document.querySelector(".foliplus-dropdown-list");
    const optionEls = (): HTMLButtonElement[] =>
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".foliplus-dropdown-option"),
      );
    const optionValuesOf = (): string[] =>
      optionEls().map(option => option.getAttribute("data-value") ?? "");
    const selectedOf = (): string[] =>
      optionEls()
        .filter(option => option.getAttribute("aria-selected") === "true")
        .map(option => option.getAttribute("data-value") ?? "");
    /** Open the popup the way a press on the trigger does. */
    const openList = (item: HTMLElement): void => {
      triggerOf(item).click();
    };
    /** One press on a row: multiple mode toggles it and keeps the popup open. */
    const clickOption = (value: string): void => {
      const option = optionEls().find(el => el.getAttribute("data-value") === value);
      expect(option).toBeDefined();
      (option as HTMLButtonElement).click();
    };
    const panelOf = (item: HTMLElement): HTMLElement | null =>
      item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`);
    const readout = (item: HTMLElement): HTMLElement =>
      item.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`) as HTMLElement;
    const clearButton = (item: HTMLElement): HTMLButtonElement =>
      item.querySelector(`.${CONST.CLASSES.FILTER_CLEAR}`) as HTMLButtonElement;
    const pressKey = (target: Element, key: string): void => {
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    };
    const mousedownOn = (target: Element): void => {
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    };
    /** The test translator: the readout sentence and the trigger's own two enum
     *  labels need pinning; every other key stays recognizable. */
    const spyTranslator = (): ReturnType<typeof vi.spyOn> =>
      vi.spyOn(ui, "T").mockImplementation(
        key =>
          ({
            filter_result: "{kept} of {total}",
            filter_enum_any: "All",
            filter_enum_count: "{n} selected",
          })[key] ?? `LayerControl.${key}`,
      );

    it("labels the condition row with the dimension's own name", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      const panel = panelOf(item)!;
      const fieldCell = panel.querySelector(
        `.${CONST.CLASSES.FILTER_FIELD}`,
      ) as HTMLElement;
      // One label only: the row's label cell carries the dimension label and
      // the control cell starts straight at the shared dropdown.
      expect(fieldCell.firstElementChild!.classList.contains("foliplus-dropdown")).toBe(
        true,
      );
      expect(fieldCell.textContent).not.toContain("Type");
      const row = fieldCell.closest(`.${CONST.CLASSES.FORM_ROW}`) as HTMLElement;
      expect(row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent).toBe(
        "Type",
      );
      spy.mockRestore();
    });

    it("replaces the native multi-select with the shared dropdown", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      const panel = panelOf(item)!;
      // The migration's whole point: no native select survives in the body.
      expect(panel.querySelector("select")).toBeNull();
      expect(panel.querySelectorAll("select[multiple]")).toHaveLength(0);
      const trigger = triggerOf(item);
      expect(trigger.tagName).toBe("BUTTON");
      expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      expect(trigger.getAttribute("aria-label")).toBe("Type");
      spy.mockRestore();
    });

    it("starts with nothing selected, which reads as all", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      expect(labelOf(item)).toBe("All");
      expect(triggerOf(item).classList.contains("foliplus-dropdown-placeholder")).toBe(
        true,
      );

      openList(item);

      const list = listOf()!;
      expect(triggerOf(item).getAttribute("aria-expanded")).toBe("true");
      expect(list.getAttribute("role")).toBe("listbox");
      expect(list.getAttribute("aria-multiselectable")).toBe("true");
      expect(optionValuesOf()).toEqual(["marker", "distance", "polygon", "circle"]);
      expect(selectedOf()).toEqual([]);
      expect(readout(item).textContent).toBe("8 of 8");
      expect(clearButton(item).disabled).toBe(true);
      spy.mockRestore();
    });

    it("commits one clicked option and keeps the popup open", () => {
      const spy = spyTranslator();
      const { item, owner } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);

      clickOption("distance");

      expect(owner.filter).toEqual({
        kind: "enum",
        field: "type",
        values: ["distance"],
      });
      expect(selectedOf()).toEqual(["distance"]);
      // Multiple semantics: a pick toggles, it does not commit-and-close.
      expect(listOf()!.hidden).toBe(false);
      expect(labelOf(item)).toBe("DISTANCE");
      expect(readout(item).textContent).toBe("2 of 8");
      spy.mockRestore();
    });

    it("adds a second clicked option and keeps the owner's order", () => {
      const spy = spyTranslator();
      const { item, owner } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);

      // Pick the last option first, then the first: the filter is serialized in
      // the owner's order, not in click order.
      clickOption("circle");
      clickOption("marker");

      expect(owner.filter).toEqual({
        kind: "enum",
        field: "type",
        values: ["marker", "circle"],
      });
      expect(selectedOf()).toEqual(["marker", "circle"]);
      // Two or more picks collapse into the count summary on the trigger.
      expect(labelOf(item)).toBe("2 selected");
      expect(readout(item).textContent).toBe("4 of 8");
      expect(listOf()!.hidden).toBe(false);
      spy.mockRestore();
    });

    it("clears the filter when the only selected option is clicked again", () => {
      const spy = spyTranslator();
      const { item, owner } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);
      clickOption("distance");
      expect(owner.filter).toBeDefined();

      clickOption("distance");

      expect(owner.filter).toBeUndefined();
      expect(selectedOf()).toEqual([]);
      expect(labelOf(item)).toBe("All");
      expect(readout(item).textContent).toBe("8 of 8");
      expect(clearButton(item).disabled).toBe(true);
      spy.mockRestore();
    });

    it("echoes a committed enum filter back into the control", () => {
      const spy = spyTranslator();
      const { item } = registerEnum(
        makeEnumOwner(undefined, {
          kind: "enum",
          field: "type",
          values: ["polygon"],
        }),
      );
      ui.openFilterPanel(item);

      expect(labelOf(item)).toBe("POLYGON");
      expect(readout(item).textContent).toBe("2 of 8");

      openList(item);
      expect(selectedOf()).toEqual(["polygon"]);
      spy.mockRestore();
    });

    it("summarises a multi-value committed filter as a count", () => {
      const spy = spyTranslator();
      const { item } = registerEnum(
        makeEnumOwner(undefined, {
          kind: "enum",
          field: "type",
          values: ["marker", "circle"],
        }),
      );
      ui.openFilterPanel(item);

      expect(labelOf(item)).toBe("2 selected");
      expect(readout(item).textContent).toBe("4 of 8");

      openList(item);
      expect(selectedOf()).toEqual(["marker", "circle"]);
      spy.mockRestore();
    });

    it("lists every declared option in one popup", () => {
      const spy = spyTranslator();
      const many = ["a", "b", "c", "d", "e", "f"];
      const { item } = registerEnum(makeEnumOwner(many));
      ui.openFilterPanel(item);

      openList(item);

      expect(optionValuesOf()).toEqual(many);
      spy.mockRestore();
    });

    it("clears an enum filter through the Clear footer", () => {
      const spy = spyTranslator();
      const { item, owner } = registerEnum(
        makeEnumOwner(undefined, {
          kind: "enum",
          field: "type",
          values: ["marker"],
        }),
      );
      ui.openFilterPanel(item);

      clearButton(item).click();

      expect(owner.filter).toBeUndefined();
      expect(labelOf(item)).toBe("All");
      spy.mockRestore();
    });

    it("Escape closes the popup first and the panel on the next press", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);

      pressKey(listOf()!, "Escape");

      // The popup is the topmost layer: one Escape closes it, not the surface.
      expect(listOf()!.hidden).toBe(true);
      expect(panelOf(item)).not.toBeNull();

      pressKey(triggerOf(item), "Escape");

      expect(panelOf(item)).toBeNull();
      spy.mockRestore();
    });

    it("a press on an option row keeps the panel and the popup open", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);
      const option = optionEls()[0];

      // The popup lives on the map surface, not in the panel: the panel must
      // classify the press as its own through the portal registration, and the
      // dropdown must not treat its own row as outside.
      option.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      mousedownOn(option);

      expect(panelOf(item)).not.toBeNull();
      expect(listOf()!.hidden).toBe(false);
      spy.mockRestore();
    });

    it("an outside press closes the panel", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      mousedownOn(document.body);

      expect(panelOf(item)).toBeNull();
      spy.mockRestore();
    });

    it("a press elsewhere in the panel keeps it open", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      mousedownOn(readout(item));

      expect(panelOf(item)).not.toBeNull();
      spy.mockRestore();
    });

    it("rebuilds the options when the owner's domain changes", () => {
      const spy = spyTranslator();
      const values = ["marker", "distance"];
      const owner = makeEnumOwner(values);
      const { item } = registerEnum(owner);
      ui.openFilterPanel(item);
      const oldTrigger = triggerOf(item);
      openList(item);
      expect(optionValuesOf()).toEqual(["marker", "distance"]);

      // The last measurement of a type is deleted: the row publishes the new
      // item count, and the panel re-reads the owner model.
      values.length = 0;
      values.push("marker");
      ui.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "measure" });

      expect(triggerOf(item)).not.toBe(oldTrigger);
      openList(item);
      expect(optionValuesOf()).toEqual(["marker"]);
      spy.mockRestore();
    });

    it("keeps a selected value whose option disappeared and reads 0 kept", () => {
      const spy = spyTranslator();
      const values = ["marker", "circle"];
      const owner = makeEnumOwner(values, {
        kind: "enum",
        field: "type",
        values: ["circle"],
      });
      const { item } = registerEnum(owner);
      ui.openFilterPanel(item);

      values.length = 0;
      values.push("marker");
      ui.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "measure" });

      // The value stays committed (the filter keeps filtering), the option is
      // gone, and the readout shows the honest 0 kept.
      expect(owner.filter).toEqual({
        kind: "enum",
        field: "type",
        values: ["circle"],
      });
      openList(item);
      expect(optionValuesOf()).toEqual(["marker"]);
      expect(readout(item).textContent).toBe("0 of 2");
      expect(clearButton(item).disabled).toBe(false);

      // Clicking the surviving option keeps the vanished value in the filter.
      clickOption("marker");
      expect(owner.filter).toEqual({
        kind: "enum",
        field: "type",
        values: ["marker", "circle"],
      });
      spy.mockRestore();
    });

    it("renders only the first dimension and warns once per panel", () => {
      const spy = spyTranslator();
      const warn = vi.spyOn(ui.log, "warn").mockImplementation(() => {});
      manager.registerLayer({
        id: "multi",
        name: "Multi",
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: () => ({
          dimensions: [
            {
              kind: "enum",
              field: "type",
              label: "Type",
              multi: true,
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ],
            },
            {
              kind: "enum",
              field: "other",
              label: "Other",
              multi: true,
              options: [{ value: "x", label: "X" }],
            },
          ],
          kept: 1,
          total: 4,
        }),
        filterSetter: () => {},
      });
      const item = findItem(ui, "multi");
      ui.openFilterPanel(item);

      openList(item);
      expect(optionValuesOf()).toEqual(["a", "b"]);
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "multi" });
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "multi" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("2 dimensions");
      warn.mockRestore();
      spy.mockRestore();
    });

    it("does not rebuild the body on repeated owner signals", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);
      const trigger = triggerOf(item);

      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "measure" });

      expect(triggerOf(item)).toBe(trigger);
      spy.mockRestore();
    });

    it("rebuilds the body when the dimension shape changes", () => {
      const spy = spyTranslator();
      let label = "Type";
      manager.registerLayer({
        id: "shape",
        name: "Shape",
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: () => ({
          dimensions: [
            {
              kind: "enum",
              field: "type",
              label,
              multi: true,
              options: [{ value: "a", label: "A" }],
            },
          ],
          kept: 1,
          total: 1,
        }),
        filterSetter: () => {},
      });
      const item = findItem(ui, "shape");
      ui.openFilterPanel(item);
      const oldTrigger = triggerOf(item);

      label = "Kind";
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "shape" });

      expect(triggerOf(item)).not.toBe(oldTrigger);
      const fieldCell = item.querySelector(
        `.${CONST.CLASSES.FILTER_FIELD}`,
      ) as HTMLElement;
      const row = fieldCell.closest(`.${CONST.CLASSES.FORM_ROW}`) as HTMLElement;
      expect(row.querySelector(`.${CONST.CLASSES.FORM_LABEL}`)!.textContent).toBe(
        "Kind",
      );
      spy.mockRestore();
    });

    it("ignores item-count changes that belong to another row", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);
      const trigger = triggerOf(item);

      ui.events.publish(EVENTS.LAYER_ITEM_COUNT_CHANGE, { id: "other" });

      expect(triggerOf(item)).toBe(trigger);
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

    it("stops the write refresh when the setter closed the panel", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const info = ui.c.layerRegistry.get("pnt") as any;
      const setter = info.filterSetter;
      info.filterSetter = (filter: any) => {
        setter(filter);
        ui.closeFilterPanel(false);
      };
      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const track = stubTrack(host);
      track.dispatchEvent(pointer("pointerdown", 25));
      track.dispatchEvent(pointer("pointermove", 25));
      track.dispatchEvent(pointer("pointerup", 25));

      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
    });

    it("closes instead of writing a retired owner (capability revoked mid-write)", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const info = ui.c.layerRegistry.get("pnt") as any;
      // The owner revokes its own capability while the panel writes: the
      // write hook must re-resolve and close, not paint over a dead owner.
      const setter = info.filterSetter;
      info.filterSetter = (filter: any) => {
        setter(filter);
        info.filterProvider = null;
      };
      ui.openFilterPanel(item);

      const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
      const track = stubTrack(host);
      track.dispatchEvent(pointer("pointerdown", 25));
      track.dispatchEvent(pointer("pointermove", 25));
      track.dispatchEvent(pointer("pointerup", 25));

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
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
      // The registry's press dispatcher carries the drag verdict the row
      // needs (the old shared pressInPanel boolean is gone).
      expect(ensureOverlayRegistry(ui.c.map).lastPressInside()).toBe(true);

      // A press outside closes the panel and clears the verdict.
      document.body.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ensureOverlayRegistry(ui.c.map).lastPressInside()).toBe(false);
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
        role: "overlay",
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
      expect(ui.overlayPanel.filterOverlayUnregister).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();
    });
  });

  describe("teardown", () => {
    it("unbindEvents closes the filter panel and releases its registry entry", () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
      expect(ui.overlayPanel.filterOverlayUnregister).not.toBeNull();

      ui.unbindEvents();

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      expect(ui.overlayPanel.filterOverlayUnregister).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();
    });

    it("unbindEvents closes an open attributes panel too", () => {
      const item = findItem(ui, "overlay1");
      ui.openAttrsPanel(item);
      expect(ui.overlayPanel.activeAttrsPanel).not.toBeNull();

      ui.unbindEvents();

      expect(item.querySelector(`.${CONST.CLASSES.ATTRS_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
      expect(ui.overlayPanel.attrsOverlayUnregister).toBeNull();
    });
  });
});

// ── Result / Clear / keyboard / row state ──
describe("LayerUI filter panel — result, Clear and row state", () => {
  let manager: LayerController;
  let ui: LayerUI;

  const registerPoints = (id = "pnt", counts?: { kept: number; total: number }) => {
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
        dimensions: [
          {
            kind: "range",
            field: "magnitude",
            label: "magnitude",
            range,
            step: 1,
          },
        ],
        filter,
        kept: counts?.kept ?? select(snapshot as any, filter).length,
        total: counts?.total ?? values.length,
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
      role: "overlay",
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
    ui.listPanel.foldedRoles = new Set();
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
    expect(ui.overlayPanel.filterOverlayUnregister).not.toBeNull();

    // The registry owns Escape: one document-capture press closes the panel,
    // and the panel's own keydown path closes nothing (it is gone).
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
    expect(ui.overlayPanel.filterOverlayUnregister).toBeNull();
  });

  it("installs no keydown on the card — the registry is the only Escape owner", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    const seen: Array<{ target: EventTarget; type: string }> = [];
    const original = EventTarget.prototype.addEventListener;
    const spy = vi
      .spyOn(EventTarget.prototype, "addEventListener")
      .mockImplementation(function (
        this: EventTarget,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ) {
        seen.push({ target: this, type });
        return original.call(this, type, listener, options);
      });

    ui.openFilterPanel(item);
    spy.mockRestore();

    const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    expect(panel).not.toBeNull();
    // The card owns no keyboard handling at all: Escape is the registry's one
    // document-capture listener, and an open popup claims the key itself. A
    // panel-level keydown here is exactly the second dispatcher C5 removed, so
    // assert its absence rather than trusting the comment.
    expect(seen.filter(s => s.target === panel && s.type === "keydown")).toEqual([]);
    // The dismissal is a registry entry, not a listener pair owned by the card.
    expect(ensureOverlayRegistry(ui.c.map).owningEntry(panel)?.id).toBe(
      OVERLAY_IDS.LAYER_FILTER,
    );
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
    // The row column stays compact (2.5K for a large kept count, pinned
    // below); only the panel Result reads the exact grouped pair. Read the
    // value span (the funnel SVG source contributes whitespace text).
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

  it("closes when the component-owned row is cleared (LAYER_DELETED)", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();

    // Heatmap-shaped rows clear through LAYER_DELETED (before the registry
    // prunes the entry); the id match, not identity, must close the panel.
    ui.events.publish(EVENTS.LAYER_DELETED, { id: "pnt" });

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("closes when the row is replaced or removed under the same id", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const panel = () => item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`);

    // Same entry + same id: a non-identity signal keeps the panel open.
    ui.events.publish(EVENTS.LAYER_ITEM_UPDATED, { id: "pnt" });
    expect(panel()).not.toBeNull();

    // Re-registration replaces the entry object: the panel must close.
    manager.registerLayer({
      id: "pnt",
      name: "Points",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() } as unknown as L.Layer,
    });
    ui.events.publish(EVENTS.LAYER_ITEM_REFRESHED, { id: "pnt" });
    expect(panel()).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("closes when the row loses its capability while open", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);

    // Same registry entry, capability revoked in place (no identity event):
    // the LAYER_FILTER_CHANGE refresh must re-resolve and close.
    (ui.c.layerRegistry.get("pnt") as any).filterProvider = null;
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("paints the funnel and the owner-unit count on the capability row", () => {
    // Heatmap shape: the capability reports its own unit (7 of 137 hex
    // cells), so the funnel belongs to THIS row — never a second data row.
    const { owner } = registerPoints("pnt", { kept: 7, total: 137 });
    manager.registerLayer({
      id: "src",
      name: "Source",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
    });
    commit(owner);
    const spy = vi.spyOn(ui, "T").mockImplementation(key => {
      if (key === "filter_row_title") return "{kept} / {total} filtered · {type}";
      if (key.startsWith("type_")) return "Point";
      return `LayerControl.${key}` as any;
    });

    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    const count = findItem(ui, "pnt").querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    expect(count.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(true);
    expect(count.querySelector(".foliplus-layer-count-value")!.textContent).toBe("7");
    expect(findItem(ui, "pnt").title).toBe("7 / 137 filtered · Point");
    // A different row is not decorated by this owner's filter.
    const other = findItem(ui, "src").querySelector(
      `.${CONST.CLASSES.COUNT_COL}`,
    ) as HTMLElement;
    expect(other.classList.contains(CONST.CLASSES.COUNT_FILTERED)).toBe(false);
    spy.mockRestore();
  });

  it("renders 0% but keeps the owner total when the filter keeps nothing", () => {
    // The heatmap shape with every cell filtered out: kept is 0, but the
    // owner still knows its unfiltered cell count — 0 of 0 would erase it.
    const { owner } = registerPoints("pnt", { kept: 0, total: 137 });
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
    const result = item.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!;
    expect(result.textContent).toBe("0% (0 of 137) kept");
    spy.mockRestore();
  });

  it("renders 0 of 0 only when the owner itself reports no records", () => {
    const { owner } = registerPoints("pnt", { kept: 0, total: 0 });
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
    const result = item.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!;
    expect(result.textContent).toBe("0% (0 of 0) kept");
    spy.mockRestore();
  });

  it("writes the result pair as exact grouped numbers, never compact", () => {
    // The row column stays compact ("2.5K"); the Result sentence reports the
    // exact pair the user is filtering — rounding it would hide the fact.
    const { owner } = registerPoints("pnt", { kept: 2500, total: 6000 });
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
    const result = item.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)!;
    expect(result.textContent).toBe("42% (2,500 of 6,000) kept");
    spy.mockRestore();
  });

  it("formats the readout with the en fallback when the locale is unset", () => {
    const { owner } = registerPoints();
    commit(owner);
    (ui.config as { locale_code?: string }).locale_code = undefined;

    const item = findItem(ui, "pnt");
    expect(() => ui.openFilterPanel(item)).not.toThrow();
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`)).not.toBeNull();
  });

  it("reconciles back to the empty state when the owner retires its model", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).not.toBeNull();

    (ui.c.layerRegistry.get("pnt") as { filterProvider: unknown }).filterProvider =
      () => null;
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`)).not.toBeNull();
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).toBeNull();
  });

  it("ignores an owner echo raised while its own write is still in flight", () => {
    const { owner } = registerPoints();
    commit(owner);
    const item = findItem(ui, "pnt");
    const info = ui.c.layerRegistry.get("pnt") as {
      filterSetter: (f: LayerFilter) => void;
    };
    const setter = info.filterSetter;
    const echo = vi.fn((f: LayerFilter) => {
      setter(f);
      // The owner repaints synchronously inside its setter: the panel's own
      // write must not rebuild under the drag that triggered it.
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });
    });
    info.filterSetter = echo;
    ui.openFilterPanel(item);

    const host = item.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`) as HTMLElement;
    const track = host.querySelector(`.foliplus-slider-track`) as HTMLElement;
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
    const pointer = (type: string, clientX: number) =>
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY: 7,
        button: 0,
      } as MouseEventInit);
    track.dispatchEvent(pointer("pointerdown", 25));
    track.dispatchEvent(pointer("pointermove", 25));
    track.dispatchEvent(pointer("pointerup", 25));

    // Each drag step writes once and echoes synchronously; no rebuild may
    // happen for those in-flight echoes.
    expect(echo).toHaveBeenCalled();
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
    expect(owner.filter).toBeDefined();
  });

  it("ignores owner signals that name another row", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);

    ui.events.publish(EVENTS.LAYER_ITEM_UPDATED, { id: "other" });
    ui.events.publish(EVENTS.LAYER_DELETED, { id: "other" });
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "other" });

    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
  });

  it("survives a filter repaint for a row element that is already gone", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    item.remove();

    expect(() =>
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" }),
    ).not.toThrow();
  });

  it("titles the row label with the full layer name, filtered or not", () => {
    const { owner } = registerPoints();
    const item = findItem(ui, "pnt");
    const label = item.querySelector(`.${CONST.CLASSES.LAYER_LABEL}`) as HTMLElement;
    const name = label.textContent!.trim();

    // Resident title, not a hover-measured one: present before any pointer
    // event, so the name is always available even when the label is short.
    expect(label.title).toBe(name);
    expect(label.title).not.toBe("");

    // A pointer event no longer rewrites it (the overflow handler is gone).
    label.dispatchEvent(new Event("pointerover", { bubbles: true }));
    expect(label.title).toBe(name);

    // Filtering repaints the row but keeps the label's full name.
    commit(owner);
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });
    const repainted = findItem(ui, "pnt");
    const repaintedLabel = repainted.querySelector(
      `.${CONST.CLASSES.LAYER_LABEL}`,
    ) as HTMLElement;
    expect(repaintedLabel.title).toBe(repaintedLabel.textContent!.trim());
    expect(repaintedLabel.title).not.toBe("");
  });

  it("keeps a large filtered count compact instead of mixing formats", () => {
    const { owner } = registerPoints("pnt", { kept: 2500, total: 6000 });
    commit(owner);
    const spy = vi.spyOn(ui, "T").mockImplementation(key => {
      if (key === "filter_row_title") return "{kept} / {total} filtered · {type}";
      if (key.startsWith("type_")) return "Point";
      return `LayerControl.${key}` as any;
    });

    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    const item = findItem(ui, "pnt");
    const count = item.querySelector(`.${CONST.CLASSES.COUNT_COL}`) as HTMLElement;
    // The column value is ALWAYS compact; the hover title keeps the exact pair.
    expect(count.querySelector(".foliplus-layer-count-value")!.textContent).toBe(
      "2.5K",
    );
    expect(item.title).toBe("2,500 / 6,000 filtered · Point");
    spy.mockRestore();
  });
});
