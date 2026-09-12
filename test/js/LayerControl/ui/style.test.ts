import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { findItem, initFixture } from "./fixture.js";

describe("LayerUI style panel", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    window.localStorage.removeItem(CONST.STORAGE.FOLD_KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none.
    ui.fieldCache.set("overlay1", ["count"]);
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
    if (map) {
      const modes = ensureModes(map);
      if (modes.getMode("LayerControl") === "focusing") {
        modes.setMode("LayerControl", null);
      }
    }
  });

  const panelOf = (item: HTMLElement): HTMLElement =>
    item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement;

  // ─────────────────── open / close lifecycle ───────────────────

  it("mounts the panel inside the layer row (attrs panel recipe)", () => {
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(ui.stylePanelLayerId).toBe("overlay1");
    const panel = panelOf(item);
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("role")).toBe("dialog");
  });

  it("builds on the shared panel vocabulary (header, content, close)", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    expect(panel.classList.contains("foliplus-panel")).toBe(true);
    expect(panel.querySelector(".foliplus-panel-header")).not.toBeNull();
    expect(panel.querySelector(".foliplus-panel-content")).not.toBeNull();
    const close = panel.querySelector(".foliplus-close-btn");
    expect(close).not.toBeNull();
    expect(close!.querySelector("svg")).not.toBeNull();
    // The label glyph sits inside the header title, like the attrs panel.
    expect(panel.querySelector(".foliplus-layer-style-icon svg")).not.toBeNull();
  });

  it("renders the toggle and both selects from the layer's config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    const toggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    const field = panel.querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    expect(field.value).toBe("");
    const format = panel.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(format.value).toBe(CONST.FORMAT.AUTO);
    // One option per cached field plus the placeholder.
    expect(field.options.length).toBe(2);
  });

  it("opens no panel for a layer without labelable fields", () => {
    ui.fieldCache.delete("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(ui.stylePanelLayerId).toBeNull();
    expect(panelOf(item)).toBeUndefined();
  });

  it("closes the previous panel before opening a new one", () => {
    const a = findItem(ui, "overlay1");
    ui.fieldCache.set("base1", ["name"]);
    const b = findItem(ui, "base1");

    ui.openStylePanel("overlay1");
    ui.openStylePanel("base1");

    expect(panelOf(a)).toBeUndefined();
    expect(panelOf(b)).not.toBeNull();
    expect(ui.stylePanelLayerId).toBe("base1");
  });

  it("dismisses the attributes panel when the style panel opens", () => {
    const item = findItem(ui, "overlay1");
    ui.openAttrsPanel(item);
    expect(item.querySelector(".foliplus-layer-attrs-panel")).not.toBeNull();

    ui.openStylePanel("overlay1");

    expect(item.querySelector(".foliplus-layer-attrs-panel")).toBeNull();
    expect(panelOf(item)).not.toBeNull();
  });

  it("closeStylePanel(setFocus=true) returns focus to the layer row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(focusSpy).toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("closeStylePanel(setFocus=false) does not focus the layer row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(false);

    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("closeStylePanel() is a no-op when no panel is open", () => {
    expect(() => ui.closeStylePanel(true)).not.toThrow();
  });

  // ─────────────────── outside dismissal ───────────────────

  it("document capture mousedown outside the panel dismisses it", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(panelOf(item)).not.toBeNull();

    // Capture phase: the layer control's disableClickPropagation never lets
    // a bubble-phase press reach document.
    document.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("mousedown inside the panel does not dismiss it", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    panel.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    expect(panelOf(item)).toBe(panel);
  });

  it("a press outside the panel dismisses it via the outside-mousedown hook", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    // jsdom does not populate event.target on dispatch, so pin it directly.
    const pressOn = (el: Element): void => {
      const event = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(event, "target", { value: el });
      ui.handleOutsideMousedown(event);
    };

    pressOn(panel.firstElementChild!);
    expect(panelOf(item)).toBe(panel);

    pressOn(document.body);
    expect(panelOf(item)).toBeUndefined();
  });

  // ─────────────────── control interactions ───────────────────

  it("flipping the toggle updates the config, labels and persistence", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");
    const saveAnnotations = vi.spyOn(manager.persistence, "saveAnnotations");

    const toggle = panelOf(item).querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
    expect(saveAnnotations).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").show).toBe(true);
  });

  it("choosing a field updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const field = panelOf(item).querySelector(
      ".foliplus-style-field-select",
    ) as HTMLSelectElement;
    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").field).toBe("count");
  });

  it("choosing a format updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const format = panelOf(item).querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    format.value = CONST.FORMAT.COMMA;
    format.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").format).toBe(
      CONST.FORMAT.COMMA,
    );
  });

  it("reset restores the default config and closes the panel", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: CONST.FORMAT.INT,
    });

    const btn = panelOf(item).querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );

    expect(manager.annotation.getConfig("overlay1")).toEqual(
      CONST.DEFAULT_ANNOTATION,
    );
    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("header click closes the panel", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item);

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panelOf(item)).toBeUndefined();
  });

  it("Escape closes an open style panel and returns focus to its row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    ui.handleKeyDown(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }) as unknown as KeyboardEvent,
    );

    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  // ─────────────────── ⋮ menu item ───────────────────

  it("the ⋮ menu's Style item is disabled without labelable fields", () => {
    ui.fieldCache.delete("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("disabled")).toBe("disabled");
    expect(styleItem.getAttribute("title")).toBe("LayerControl.label_no_data");
  });

  it("the ⋮ menu's Style item is enabled once the layer has fields", () => {
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const items = Array.from(
      item.querySelectorAll(".foliplus-layer-more-menu li"),
    ) as HTMLElement[];
    const actions = items.map(li => li.dataset.action);
    // Order: focus, rename, style, attributes — editing actions group before
    // the display-only attributes entry.
    expect(actions).toEqual([
      CONST.ACTION.FOCUS_LAYER,
      CONST.ACTION.RENAME_LAYER,
      CONST.ACTION.STYLE_LAYER,
      CONST.ACTION.ATTRS_LAYER,
    ]);
    const styleItem = items[2];
    expect(styleItem.getAttribute("disabled")).toBeNull();
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item is disabled for the color basemap", () => {
    const item = ui.uiContainer.querySelector(CONST.SEL.COLOR_ITEM) as HTMLElement;

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("disabled")).toBe("disabled");
  });

  // ─────────────────── field cache ───────────────────

  it("caches collectFields per layer id", () => {
    ui.fieldCache.delete("overlay1");
    const collect = vi.spyOn(manager.annotation, "collectFields");

    expect(ui.layerHasLabelFields("overlay1")).toBe(false);
    expect(ui.layerHasLabelFields("overlay1")).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);
  });

  it("drops a stale cached empty field list on LAYER_ITEM_COUNT_CHANGE", () => {
    // A layer registered with no labelable fields caches an empty list; a
    // runtime createLayers may later add features carrying properties, which
    // must un-stick the ⋮ menu's Style item.
    expect(ui.layerHasLabelFields("overlay1")).toBe(false);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);

    const fields = ["count", "name"];
    vi.spyOn(manager.annotation, "collectFields").mockReturnValue(fields);

    ui.onLayerItemCountChange("overlay1");

    expect(ui.fieldCache.has("overlay1")).toBe(false);
    expect(ui.layerHasLabelFields("overlay1")).toBe(true);
  });

  it("invalidateFields drops a layer's cached list", () => {
    ui.layerHasLabelFields("overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(true);

    ui.invalidateFields("overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(false);
  });

  // ─────────────────── persisted state ───────────────────

  it("applyAnnotationState re-renders labels for show+field configs only", () => {
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: CONST.FORMAT.AUTO,
    });
    ui.annotationConfigs = {
      overlay1: { show: true, field: "count", format: CONST.FORMAT.AUTO },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyAnnotationState();

    expect(setConfig).toHaveBeenCalledWith("overlay1", {
      show: true,
      field: "count",
      format: CONST.FORMAT.AUTO,
    });
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyAnnotationState skips configs without show+field", () => {
    ui.annotationConfigs = { overlay1: { show: true, field: "" } };
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyAnnotationState();

    expect(renderLabels).not.toHaveBeenCalled();
  });
});
