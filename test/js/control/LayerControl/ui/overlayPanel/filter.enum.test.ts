// test/js/control/LayerControl/ui/style/filter.enum — the enum body and row identity.
import { findItem, initFixture } from "../fixture.js";
import { makeEnumOwner, makeOwner, mkPointLayer } from "./filter.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilterModel } from "#core/layer/index.js";
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
    /** The open popup is portalled out of the panel (ui/dropdown), so it is
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

    it("labels the condition row from the shared panel vocabulary", () => {
      const spy = spyTranslator();
      const { item } = registerEnum();
      ui.openFilterPanel(item);

      const panel = panelOf(item)!;
      // The enum condition row is reached by its stable data-* identity: the
      // field row also carries FILTER_FIELD, so the shared class would match
      // the wrong row now that both bodies render a field row.
      const fieldCell = panel.querySelector(
        `[data-filter-value="enum"]`,
      ) as HTMLElement;
      // One label only: the row's label cell carries the shared "Values"
      // caption (never a component word like "Type") and the control cell
      // starts straight at the shared dropdown.
      expect(fieldCell.firstElementChild!.classList.contains("foliplus-dropdown")).toBe(
        true,
      );
      expect(fieldCell.textContent).not.toContain("Type");
      const row = fieldCell.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
      expect(row.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent).toBe(
        ui.T("filter_enum"),
      );
      // The control group and its trigger share that same accessible name.
      expect(fieldCell.getAttribute("role")).toBe("group");
      expect(fieldCell.getAttribute("aria-label")).toBe(ui.T("filter_enum"));
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
      expect(trigger.getAttribute("aria-label")).toBe(ui.T("filter_enum"));
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

    it("Escape dismisses the popup then the panel without changing the picked values", () => {
      const spy = spyTranslator();
      const { item, owner } = registerEnum();
      ui.openFilterPanel(item);
      openList(item);
      clickOption("marker");
      clickOption("distance");

      const committed = {
        kind: "enum" as const,
        field: "type",
        values: ["marker", "distance"],
      };
      expect(selectedOf()).toEqual(["marker", "distance"]);
      expect(owner.filter).toEqual(committed);

      // The popup is the topmost layer: Escape closes it alone. The owner keeps
      // the committed multi-selection through the close — Escape dismisses, it
      // never rewrites what the user picked.
      pressKey(optionEls()[0], "Escape");
      expect(listOf()!.hidden).toBe(true);
      expect(panelOf(item)).not.toBeNull();
      expect(selectedOf()).toEqual(["marker", "distance"]);
      expect(owner.filter).toEqual(committed);

      // The next press closes the panel layer; the committed filter is untouched.
      pressKey(triggerOf(item), "Escape");
      expect(panelOf(item)).toBeNull();
      expect(owner.filter).toEqual(committed);
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
              multi: true,
              options: [
                { value: "a", label: "A" },
                { value: "b", label: "B" },
              ],
            },
            {
              kind: "enum",
              field: "other",
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
      let field = "type";
      manager.registerLayer({
        id: "shape",
        name: "Shape",
        role: "overlay",
        layer: undefined as unknown as L.Layer,
        filterProvider: () => ({
          dimensions: [
            {
              kind: "enum",
              field,
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

      field = "other";
      ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "shape" });

      expect(triggerOf(item)).not.toBe(oldTrigger);
      const fieldCell = item.querySelector(`[data-filter-value="enum"]`) as HTMLElement;
      const row = fieldCell.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement;
      // The caption stays panel-owned across the rebuild.
      expect(row.querySelector(`.${PANEL_CLASS.FORM_LABEL}`)!.textContent).toBe(
        ui.T("filter_enum"),
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
    it("shows the truncation hint when the owner truncated the domain", () => {
      const owner = makeEnumOwner(Array.from({ length: 60 }, (_, i) => `v${i}`));
      // Patch the provider to set truncated=true on the dimension.
      const baseProvider = owner.filterProvider;
      owner.filterProvider = () => {
        const model = baseProvider();
        return {
          ...model,
          dimensions: model.dimensions.map(d => ({ ...d, truncated: true })),
        };
      };
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
      const hint = panel.querySelector(
        `.${CONST.CLASSES.FILTER_ENUM_HINT}`,
      ) as HTMLElement;
      expect(hint).not.toBeNull();
      expect(hint.textContent).toBe("LayerControl.filter_enum_truncated");
    });

    it("renders no truncation hint for a full domain", () => {
      const { item } = registerEnum();
      ui.openFilterPanel(item);
      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      expect(panel.querySelector(`.${CONST.CLASSES.FILTER_ENUM_HINT}`)).toBeNull();
    });
  });

  describe("field / value row data-* identity", () => {
    /** The field and value rows must be addressable by their stable data-*
     *  identity, not by a shared class (a multi-condition tree can reuse
     *  the FILTER_FIELD class, so class-name reach-around is the very
     *  bug class this guards). */
    const multiFieldProvider = (): LayerFilterModel => ({
      dimensions: [
        { kind: "range", field: "mag", range: [0, 10] as [number, number], step: 1 },
        {
          kind: "enum",
          field: "kind",
          options: [{ value: "a", label: "A" }],
          multi: true,
        },
      ],
      filter: undefined,
      kept: 10,
      total: 10,
      fields: [
        { value: "mag", label: "mag", numeric: true },
        { value: "kind", label: "kind", numeric: false },
      ],
      onField: () => {},
    });
    const openMulti = (): HTMLElement => {
      registerPoints();
      const reg = ui.c.layerRegistry.get("pnt") as any;
      reg.filterProvider = multiFieldProvider;
      reg.filterSetter = () => {};
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      return item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
    };

    it("addresses the field row by data-filter-field (not by class)", () => {
      const panel = openMulti();
      const fieldRow = panel.querySelector(`[data-filter-field="mag"]`) as HTMLElement;
      expect(fieldRow).not.toBeNull();
      // The data-* query disambiguates the row that the shared FILTER_FIELD
      // class also matches; the class query is not the unique path.
      expect(
        panel.querySelectorAll(`.${CONST.CLASSES.FILTER_FIELD}`).length,
      ).toBeGreaterThanOrEqual(1);
    });

    it("addresses the range value row by data-filter-value=range", () => {
      const panel = openMulti();
      const valueRow = panel.querySelector(
        `[data-filter-value="range"]`,
      ) as HTMLElement;
      expect(valueRow).not.toBeNull();
    });

    it("addresses the enum value row by data-filter-value=enum after switching", () => {
      const panel = openMulti();
      const select = panel.querySelector("select") as HTMLSelectElement;
      select.value = "kind";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      const enumRow = panel.querySelector(`[data-filter-value="enum"]`) as HTMLElement;
      expect(enumRow).not.toBeNull();
      // The field row survives the switch and still carries the new field.
      const fieldRow = panel.querySelector(`[data-filter-field="kind"]`) as HTMLElement;
      expect(fieldRow).not.toBeNull();
    });

    it("keeps exactly one field row in the panel after switching to enum", () => {
      const panel = openMulti();
      const select = panel.querySelector("select") as HTMLSelectElement;
      select.value = "kind";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      // One field row, never two (the enum body must not add a second one).
      expect(panel.querySelectorAll(`[data-filter-field]`).length).toBe(1);
      // One value row: the enum body's own row, not the range slider.
      expect(panel.querySelectorAll(`[data-filter-value]`).length).toBe(1);
    });

    it("orders the field row before the value row", () => {
      const panel = openMulti();
      const fieldRow = panel.querySelector(`[data-filter-field="mag"]`) as HTMLElement;
      const valueRow = panel.querySelector(
        `[data-filter-value="range"]`,
      ) as HTMLElement;
      const rows = Array.from(panel.querySelectorAll(`.${PANEL_CLASS.FORM_ROW}`));
      const fieldIdx = rows.indexOf(
        fieldRow.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement,
      );
      const valueIdx = rows.indexOf(
        valueRow.closest(`.${PANEL_CLASS.FORM_ROW}`) as HTMLElement,
      );
      expect(fieldIdx).toBeGreaterThanOrEqual(0);
      expect(valueIdx).toBeGreaterThan(fieldIdx);
    });

    it("gives the read-only field cell the same data-* identity", () => {
      // An owner without fields (Heatmap/Measure) still gets the identity.
      registerPoints();
      const item = findItem(ui, "pnt");
      ui.openFilterPanel(item);
      const panel = item.querySelector(`.${CONST.CLASSES.FILTER_PANEL}`) as HTMLElement;
      const fieldRow = panel.querySelector(
        `[data-filter-field="magnitude"]`,
      ) as HTMLElement;
      expect(fieldRow).not.toBeNull();
      expect(fieldRow.querySelector("select")).toBeNull();
    });

    it("does not leak the field identity onto the value row", () => {
      const panel = openMulti();
      const valueRow = panel.querySelector(
        `[data-filter-value="range"]`,
      ) as HTMLElement;
      expect(valueRow.getAttribute("data-filter-field")).toBeNull();
      const fieldRow = panel.querySelector(`[data-filter-field="mag"]`) as HTMLElement;
      expect(fieldRow.getAttribute("data-filter-value")).toBeNull();
    });
  });
});
