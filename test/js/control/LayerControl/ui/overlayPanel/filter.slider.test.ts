// test/js/control/LayerControl/ui/style/filter.slider — the slider write path, owner signals and the result row.
import { findItem, initFixture } from "../fixture.js";
import { makeOwner, mkPointLayer } from "./filter.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilter, type LayerFilterModel, select } from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlay/index.js";
import { SLIDER_CLASS } from "#ui/index.js";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";

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
    ui.listPanel.foldedRoles = {};
    window.localStorage.removeItem(CONST.STORAGE.KEY);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  describe("slider write path (through the owner capability)", () => {
    /** The slider.test.ts pointer recipe: jsdom reports 0×0 rects, the
     *  pointer paths need a rail with a measurable box. */
    const stubTrack = (host: HTMLElement): HTMLElement => {
      const track = host.querySelector(`.${SLIDER_CLASS.TRACK}`) as HTMLElement;
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
      const maxThumb = host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)[1];
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
      host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)[1].dispatchEvent(
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
      const thumbs = host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
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
      const thumbs = panel.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
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
        (
          item.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)[0] as HTMLElement
        ).getAttribute("aria-valuenow"),
      ).toBe("15");

      // The owner retired the filter on its own (source reset, content
      // revalidation, the more-menu clear).
      owner.filterSetter(undefined);
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

      const thumbs = item.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
    });

    it("a same-id replacement closes the panel and retires the old setter", () => {
      const oldOwner = makeOwner([10, 20, 30]);
      const oldSetter = vi.spyOn(oldOwner, "filterSetter");
      registerPoints("pnt", oldOwner);
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      const staleThumb = item.querySelectorAll(`.${SLIDER_CLASS.THUMB}`)[0];

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
    it("deleting a user-added layer closes its open filter panel (LAYER_REMOVED)", () => {
      // A user-added (non-component-owned) layer retires through retireEntry →
      // LAYER_REMOVED (not LAYER_DELETED). The filter panel must close on that
      // path — this is the v1 gap the dual subscription fixes.
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();

      expect(manager.deleteLayer("pnt")).toBe(true);

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      expect(ui.overlayPanel.filterUnsubscribe).toBeNull();
    });

    it("deleting a component-owned layer closes its open filter panel (LAYER_DELETED regression lock)", () => {
      // Heatmap/Measure rows are component-owned (styleSetters): deleteLayer
      // emits LAYER_DELETED, not LAYER_REMOVED. The filter panel's existing
      // LAYER_DELETED subscription must stay — this is the regression lock.
      const owner = makeOwner([10, 20, 30]);
      manager.registerLayer({
        id: "heat1",
        name: "Heat",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
        styleSetters: { color: vi.fn() },
        filterProvider: owner.filterProvider,
        filterSetter: owner.filterSetter,
      } as any);
      const item = findItem(ui, "heat1");
      ui.openFilterPanel(item);
      expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();

      expect(manager.deleteLayer("heat1")).toBe(true);

      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      expect(ui.overlayPanel.activeFilterPanel).toBeNull();
    });

    it("deleting another layer keeps this filter panel open", () => {
      registerPoints();
      manager.registerLayer({
        id: "L2",
        name: "Other",
        role: "overlay",
        layer: { options: {}, eachLayer: vi.fn() },
      } as any);
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();

      expect(manager.deleteLayer("L2")).toBe(true);

      expect(ui.overlayPanel.activeFilterPanel?.layerId).toBe("pnt");
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
    ui.listPanel.foldedRoles = {};
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
    const row = result.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
    expect(row.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent).toBe(
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

  it("reports a throwing owner setter and keeps the panel open", () => {
    const { owner } = registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    commit(owner);
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "pnt" });

    const reg = manager.layerRegistry.get("pnt")!;
    (reg as unknown as { filterSetter: () => void }).filterSetter = () => {
      throw new Error("boom");
    };
    const warn = vi.spyOn(ui.log, "warn").mockImplementation(() => {});
    (
      panel.querySelector(`.${CONST.CLASSES.FILTER_CLEAR}`) as HTMLButtonElement
    ).click();

    expect(warn).toHaveBeenCalled();
    // Clear keeps the panel open (keep-open policy): the focus half still ran.
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
    warn.mockRestore();
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

  it("its registry entry reports no containment once the panel is gone", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    const entry = ensureOverlayRegistry(ui.c.map).owningEntry(panel);
    expect(entry?.id).toBe(OVERLAY_IDS.LAYER_FILTER);
    expect(entry?.panels()).toEqual([panel]);

    ui.closeFilterPanel(false);

    // A late dispatch after the close asks the same closure, and it reads the
    // live state — containment must be empty, not a detached panel.
    expect(entry?.panels()).toEqual([]);
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
    // Grab the lower thumb itself: the committed band [10,20] spans x 0..50,
    // and a press in that segment now pans the pair (the pan feature's grab
    // region). The echo-suppression contract is what this test covers, so it
    // drags the handle instead of the band.
    track.dispatchEvent(pointer("pointerdown", 0));
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
