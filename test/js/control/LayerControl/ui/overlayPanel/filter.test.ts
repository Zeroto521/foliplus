// test/js/control/LayerControl/ui/style/filter — the menu gate, opening/closing and teardown.
import { findItem, initFixture } from "../fixture.js";
import {
  makeEnumOwner,
  makeOwner,
  menuActionNames,
  mkPointLayer,
} from "./filter.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LayerFilter, type LayerFilterModel } from "#core/layer/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { SLIDER_CLASS } from "#ui/index.js";
import { PANEL_CLASS } from "#ui/panelClassName.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { clearSurface } from "#control/LayerControl/ui/overlayPanel/openSurface.js";

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
  describe("the ⋮ menu gate", () => {
    it("hides the filter entry for layers without the filter capability", () => {
      // A base layer is excluded from the generic filter injection (role
      // check in injectGenericFilterCapability), so its ⋮ menu has no
      // Filter entry — a control that can never run is not rendered at all.
      const item = findItem(ui, "base1");
      ui.openMoreMenu(item);
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
      clearSurface(ui, "menu");
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
      // Row 1 is the field row: the shared "Field" caption beside the
      // read-only field name — two cells answering two questions, so the field
      // name is never printed as the caption with an empty control cell.
      const field = panel.querySelector(
        `.${CONST.CLASSES.FILTER_FIELD}`,
      ) as HTMLElement;
      const fieldRow = field.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
      expect(fieldRow.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent).toBe(
        ui.T("filter_field"),
      );
      expect(
        fieldRow.querySelector(`.${CONST.CLASSES.FILTER_FIELD_VALUE}`)!.textContent,
      ).toBe("magnitude");
      // Row 2 is the condition row: the shared "Range" caption beside the
      // slider — never a component's own word for the control.
      const sliderRow = fieldRow.nextElementSibling as HTMLElement;
      expect(sliderRow.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent).toBe(
        ui.T("filter_range"),
      );
      // Range row: the shared Slider — two real thumbs, not stacked range
      // inputs, both parked at the full extent for "no filter".
      const host = panel.querySelector(
        `.${CONST.CLASSES.FILTER_SLIDER}`,
      ) as HTMLElement;
      const thumbs = host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
      expect(thumbs).toHaveLength(2);
      expect(panel.querySelector("input[type=range]")).toBeNull();
      expect(thumbs[0].getAttribute("aria-valuenow")).toBe("10");
      expect(thumbs[1].getAttribute("aria-valuenow")).toBe("30");
      // Result row: a live region fed by the owner model.
      const result = panel.querySelector(`.${CONST.CLASSES.FILTER_RESULT}`);
      expect(result!.getAttribute("aria-live")).toBe("polite");
    });

    describe("field picker (multi-field owner)", () => {
      /** A generic owner that offers two numeric fields, so the range body
       *  renders a picker instead of the read-only cell. The committed filter
       *  is the only state; onField clears it (the controller contract). */
      const makeMultiFieldOwner = () => {
        let filter: LayerFilter | undefined;
        return {
          filterProvider: (): LayerFilterModel => ({
            dimensions: [
              {
                kind: "range",
                field: "mag",
                range: [0, 10] as [number, number],
                step: 1,
              },
              {
                kind: "range",
                field: "depth",
                range: [0, 100] as [number, number],
                step: 5,
              },
            ],
            filter,
            kept: filter ? 3 : 10,
            total: 10,
            fields: [
              { value: "mag", label: "mag", numeric: true },
              { value: "depth", label: "depth", numeric: true },
            ],
            onField: () => {
              filter = undefined;
            },
          }),
          filterSetter: (f: LayerFilter) => {
            filter = f;
          },
          get filter() {
            return filter;
          },
        };
      };

      it("renders a field dropdown when the model offers fields", () => {
        const owner = makeMultiFieldOwner();
        registerPoints();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const fieldRow = panel
          .querySelector(`.${CONST.CLASSES.FILTER_FIELD}`)!
          .closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
        // A picker replaces the read-only cell: a native select bridged by the
        // shared dropdown, defaulted to the first field (D8: nothing committed).
        const select = fieldRow.querySelector("select") as HTMLSelectElement;
        expect(select).not.toBeNull();
        expect(select.value).toBe("mag");
        expect(Array.from(select.options).map(o => o.value)).toEqual(["mag", "depth"]);
      });

      it("switching fields clears the old filter and rebuilds for the new field", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        // Commit a mag-range write, then switch to depth: the old atom is
        // cleared (D5) and the body rebuilds on the depth dimension extent.
        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        // Commit a mag-range atom directly through the owner capability (the
        // slider drag needs a real pointer; the switch path is what we test).
        owner.filterSetter({
          kind: "atom",
          field: "mag",
          op: "between",
          range: [2, 8],
        });
        expect(owner.filter).toBeDefined();

        const select = panel.querySelector("select") as HTMLSelectElement;
        select.value = "depth";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(owner.filter).toBeUndefined();
        const rebuilt = panel.querySelector(
          `.${CONST.CLASSES.FILTER_SLIDER}`,
        ) as HTMLElement;
        const rt = rebuilt.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
        expect(rt[0].getAttribute("aria-valuenow")).toBe("0");
        expect(rt[1].getAttribute("aria-valuenow")).toBe("100");
      });

      it("switches fields without a transient notice row", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);
        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const rowsBefore = panel.querySelectorAll(".foliplus-form-row").length;

        // No auto-hide timer may be scheduled for a notice: the switch is
        // silent, so the panel body keeps exactly its own rows.
        const timerSpy = vi.spyOn(window, "setTimeout");

        // Commit a mag atom, then switch to depth: the switch discards the
        // committed condition, and the panel says nothing about it.
        owner.filterSetter({
          kind: "atom",
          field: "mag",
          op: "between",
          range: [2, 8],
        });
        const select = panel.querySelector("select") as HTMLSelectElement;
        select.value = "depth";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(timerSpy.mock.calls.some(call => Number(call[1]) === 4000)).toBe(false);
        timerSpy.mockRestore();
        expect(document.querySelector(".foliplus-filter-field-hint")).toBeNull();
        expect(panel.querySelectorAll(".foliplus-form-row").length).toBe(rowsBefore);
        // The switch still lands: the depth slider replaced the mag one.
        expect(panel.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).not.toBeNull();
      });

      it("a stale select change after the panel closed does not rebuild", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        ui.closeFilterPanel(false);
        expect(ui.overlayPanel.activeFilterPanel).toBeNull();

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement | null;
        const select = panel?.querySelector("select") as HTMLSelectElement | null;
        if (select) {
          select.value = "depth";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        // No throw, no rebuild: the closed panel stays closed.
        expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      });

      it("selectField with a stale capability closes instead of writing", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        // The owner revokes its capability in place (no identity event), so
        // the open panel is stale: a field switch must resolve to no live
        // capability and close rather than write into the retired owner.
        reg.filterProvider = null;
        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const select = panel.querySelector("select") as HTMLSelectElement;
        select.value = "depth";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
        expect(ui.overlayPanel.activeFilterPanel).toBeNull();
      });

      it("selectField rebuilds for the newly chosen field", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const select = panel.querySelector("select") as HTMLSelectElement;
        select.value = "depth";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        // onField cleared the committed filter and the body rebuilt for the
        // new field: the depth slider replaced the mag one.
        expect(owner.filter).toBeUndefined();
        expect(panel.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).not.toBeNull();
        const rowLabels = panel.querySelectorAll(
          ".foliplus-form-row .foliplus-form-label",
        );
        // The first label is the field row's caption; the range row is second.
        expect(rowLabels[1].textContent).toBe(ui.T("filter_range"));
      });

      it("closeFilterPanel destroys a rows body but leaves the empty body alone", () => {
        registerPoints();
        const owner = makeMultiFieldOwner();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);
        ui.closeFilterPanel(false);
        // No throw and no leak: the rows view's destroy ran, the panel is gone.
        expect(ui.overlayPanel.activeFilterPanel).toBeNull();
        expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      });

      it("closeFilterPanel leaves the empty body alone and removes the panel", () => {
        registerPoints();
        // A row with no capability: the panel shows the empty body, and the
        // close path must skip the rows-body destroy (there is none).
        const item = findItem(ui, "overlay1");
        ui.openFilterPanel(item);
        expect(item.querySelector(`.${CONST.CLASSES.FILTER_EMPTY}`)).not.toBeNull();
        ui.closeFilterPanel(false);
        expect(ui.overlayPanel.activeFilterPanel).toBeNull();
        expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      });

      it("falls back to the first field when the committed atom names an unknown field", () => {
        // A persisted atom whose field is not offered falls back to the
        // first available field (D8) without throwing.
        const owner = makeMultiFieldOwner();
        owner.filterSetter({
          kind: "atom",
          field: "ghost",
          op: "between",
          range: [1, 2],
        });
        registerPoints();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = owner.filterProvider;
        reg.filterSetter = owner.filterSetter;
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const fieldRow = panel
          .querySelector(`.${CONST.CLASSES.FILTER_FIELD}`)!
          .closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
        const select = fieldRow.querySelector("select") as HTMLSelectElement;
        expect(select.value).toBe("mag");
        const host = panel.querySelector(
          `.${CONST.CLASSES.FILTER_SLIDER}`,
        ) as HTMLElement;
        // The ghost atom is clamped onto the fallback (mag) dimension extent.
        const thumbs = host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
        expect(thumbs[0].getAttribute("aria-valuenow")).toBe("1");
        expect(thumbs[1].getAttribute("aria-valuenow")).toBe("2");
      });

      it("renders an empty picker when the owner offers an empty field list", () => {
        let filter: LayerFilter | undefined;
        registerPoints();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = (): LayerFilterModel => ({
          dimensions: [
            {
              kind: "range",
              field: "mag",
              range: [0, 10] as [number, number],
              step: 1,
            },
          ],
          filter,
          kept: 10,
          total: 10,
          fields: [],
        });
        reg.filterSetter = (f: LayerFilter) => {
          filter = f;
        };
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const fieldRow = panel
          .querySelector(`.${CONST.CLASSES.FILTER_FIELD}`)!
          .closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
        // fields: [] is truthy, so the picker branch still runs — an empty
        // option list renders (the select exists but offers nothing).
        const select = fieldRow.querySelector("select") as HTMLSelectElement;
        expect(select).not.toBeNull();
      });
      it("keeps the read-only field cell for owners without fields (zero change)", () => {
        // Counter-guard: a Heatmap/Measure owner (no fields) renders the
        // read-only cell, never a select — the regression the field picker
        // must not disturb.
        registerPoints();
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        const fieldRow = panel
          .querySelector(`.${CONST.CLASSES.FILTER_FIELD}`)!
          .closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
        expect(fieldRow.querySelector("select")).toBeNull();
        expect(fieldRow.textContent).toContain("magnitude");
      });
      it("switches to an enum field through the picker and renders the enum body", () => {
        let filter: LayerFilter | undefined;
        registerPoints();
        const reg = ui.c.layerRegistry.get("pnt") as any;
        reg.filterProvider = (): LayerFilterModel => ({
          dimensions: [
            {
              kind: "range",
              field: "mag",
              range: [0, 10] as [number, number],
              step: 1,
            },
            {
              kind: "enum",
              field: "kind",
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ],
              multi: true,
            },
          ],
          filter,
          kept: 10,
          total: 10,
          fields: [
            { value: "mag", label: "mag", numeric: true },
            { value: "kind", label: "kind", numeric: false },
          ],
          onField: () => {
            filter = undefined;
          },
        });
        reg.filterSetter = (f: LayerFilter) => {
          filter = f;
        };
        const item = findItem(ui, "pnt");
        ui.openFilterPanel(item);

        const panel = item.querySelector(
          `.${CONST.CLASSES.FILTER_PANEL}`,
        ) as HTMLElement;
        // The picker offers both fields and defaults to the first (mag).
        const select = panel.querySelector("select") as HTMLSelectElement;
        expect(Array.from(select.options).map(o => o.value)).toEqual(["mag", "kind"]);

        // Switch to the enum field: the body rebuilds as the enum dropdown.
        select.value = "kind";
        select.dispatchEvent(new Event("change", { bubbles: true }));

        expect(panel.querySelector(`.${CONST.CLASSES.FILTER_SLIDER}`)).toBeNull();
        expect(panel.querySelector(`.${CONST.CLASSES.FILTER_ENUM}`)).not.toBeNull();
        // The P1 regression: switching to an enum field must NOT drop the
        // field row — the panel still answers "which field" next to "what
        // values". The field row carries the stable data-* identity.
        const fieldRow = panel.querySelector(
          `[data-filter-field="kind"]`,
        ) as HTMLElement;
        expect(fieldRow).not.toBeNull();
        // The field select still offers both fields and stays on the enum one.
        const fieldSelect = fieldRow.querySelector("select") as HTMLSelectElement;
        expect(fieldSelect.value).toBe("kind");
        expect(Array.from(fieldSelect.options).map(o => o.value)).toEqual([
          "mag",
          "kind",
        ]);
      });
    });

    it("names the range group with the shared condition caption", () => {
      // Both branches expose the condition caption as the control's accessible
      // name: here the dual-thumb slider host is a named group, and the enum
      // branch names its dropdown with the same panel vocabulary.
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const host = panel.querySelector(
        `.${CONST.CLASSES.FILTER_SLIDER}`,
      ) as HTMLElement;
      expect(host.getAttribute("role")).toBe("group");
      expect(host.getAttribute("aria-label")).toBe(ui.T("filter_range"));
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
      const thumbs = host.querySelectorAll(`.${SLIDER_CLASS.THUMB}`);
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
      expect(host.classList.contains(SLIDER_CLASS.DISABLED)).toBe(true);
      const thumb = host.querySelector(`.${SLIDER_CLASS.THUMB}`) as HTMLElement;
      expect(thumb.getAttribute("aria-disabled")).toBe("true");
    });

    it("falls back to the layer id when the display name is empty", async () => {
      registerPoints();
      const item = findItem(ui, "pnt");
      const rowView = await import("#control/LayerControl/ui/listPanel/rowView.js");
      const spy = vi.spyOn(rowView, "displayName").mockReturnValue("");

      ui.openFilterPanel(item);

      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(".foliplus-header-title")!.textContent).toContain(
        "pnt",
      );
      spy.mockRestore();
    });
  });

  it("reopen after close does not trip the duplicate-id guard", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    ui.closeFilterPanel(false);
    expect(() => ui.openFilterPanel(item)).not.toThrow();
    expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).not.toBeNull();
    ui.closeFilterPanel(false);
  });

  it("close detaches the registry entry (no live overlay after close)", () => {
    registerPoints();
    const item = findItem(ui, "pnt");
    ui.openFilterPanel(item);
    const registry = ensureOverlayRegistry(_map);
    expect(registry.topmost()).not.toBeNull();
    ui.closeFilterPanel(false);
    expect(registry.topmost()).toBeNull();
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
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

    it("header click closes the panel without bubbling to the map", () => {
      // A press on the header (or the × inside it) must not also become a map
      // click: closing the panel removes it mid-dispatch, so the click would
      // otherwise keep walking its original path with no live control ancestor
      // and land on the map (the same guarantee as the ⋮ menu — #807).
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      const bubbled = vi.fn();
      item.addEventListener("click", bubbled);

      const header = item.querySelector(
        `.${CONST.CLASSES.FILTER_PANEL} .foliplus-panel-header`,
      ) as HTMLElement;
      header.click();

      // The panel still closes…
      expect(item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`)).toBeNull();
      // …and the press was swallowed, never reaching the row / map.
      expect(bubbled).not.toHaveBeenCalled();
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
