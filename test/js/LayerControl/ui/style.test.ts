import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { LayerManager } from "#foliplus/LayerControl/manager.js";
import type { LayerUI } from "#foliplus/LayerControl/ui/index.js";
import {
  layerHasLabelFields,
  layerHasStyleDelegation,
} from "#foliplus/LayerControl/ui/style.js";
import { AUTO_FIELD } from "#foliplus/core/labelField.js";
import { ensureModes } from "#foliplus/core/mode.js";
import { NUMBER_FORMAT } from "#common/format.js";
import { findItem, initFixture } from "./fixture.js";

describe("LayerUI style panel", () => {
  let manager: LayerManager;
  let ui: LayerUI;
  let map: any;

  beforeEach(() => {
    ({ manager, ui, map } = initFixture());
    ui.foldedGroups = new Set();
    ui.hiddenIds = new Set();
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none. `count` is a
    // number, which is what makes the number-format row reachable.
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
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

  const panelOf = (item: HTMLElement): HTMLElement | undefined =>
    (item.querySelector(`.${CONST.CLASSES.STYLE_PANEL}`) as HTMLElement | null) ??
    undefined;

  const formatRowOf = (item: HTMLElement): HTMLElement =>
    panelOf(item)!.querySelector(".foliplus-style-format-row") as HTMLElement;

  const bodyOf = (item: HTMLElement): HTMLElement =>
    panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;

  const toggleOf = (item: HTMLElement): HTMLInputElement =>
    panelOf(item)!.querySelector(".foliplus-style-toggle-input") as HTMLInputElement;

  const fieldSelectOf = (item: HTMLElement): HTMLSelectElement =>
    panelOf(item)!.querySelector(".foliplus-style-field-select") as HTMLSelectElement;

  const formatSelectOf = (item: HTMLElement): HTMLSelectElement =>
    panelOf(item)!.querySelector(".foliplus-style-format-select") as HTMLSelectElement;

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
    expect(format.value).toBe(NUMBER_FORMAT.AUTO);
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
    ui.fieldCache.set("base1", [{ name: "name", numeric: false }]);
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

    // The dismiss handler has to be registered in the *capture* phase, because
    // the layer control stops mousedown from bubbling (Leaflet's
    // disableClickPropagation). Dispatching on `document` cannot prove that —
    // target === currentTarget, so a bubble-phase listener would run too. A
    // wrapper that swallows the bubble, plus a press dispatched on its child,
    // does: capture runs on the way down (document is reached), bubble never
    // gets there. This test fails if the handler is ever moved to bubble.
    const wrapper = document.createElement("div");
    wrapper.addEventListener("mousedown", e => e.stopPropagation());
    const outside = document.createElement("button");
    wrapper.appendChild(outside);
    document.body.appendChild(wrapper);

    outside.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );

    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
    wrapper.remove();
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
    const saveAnnotations = vi.spyOn(manager.persistence, "schedule");

    const toggle = panelOf(item).querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
    expect(saveAnnotations).toHaveBeenCalled();
    const fields = saveAnnotations.mock.calls.at(-1)![0] as {
      annotations: () => Record<string, Record<string, unknown>>;
    };
    expect(fields.annotations().overlay1).toEqual(
      expect.objectContaining({ show: true }),
    );
    expect(manager.annotation.getConfig("overlay1").show).toBe(true);
  });

  it("opens no panel for an empty layer id", () => {
    ui.openStylePanel("");

    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("renders the avoid-overlap switch, defaulting on from the page", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // No stored choice yet: the page default (label_collide ?? true) is on.
    expect(collide.checked).toBe(true);
    expect(collide.getAttribute("aria-label")).toBeTruthy();
  });

  it("flipping the avoid-overlap switch patches the layer's collide flag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    collide.checked = false;
    collide.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").collide).toBe(false);
  });

  it("annotation body order is field → color/size → format → collide", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const rows = [
      ...panelOf(item).querySelectorAll(".foliplus-style-body .foliplus-form-row"),
    ];
    const labels = rows.map(
      r => r.querySelector(".foliplus-form-label")?.textContent ?? "",
    );
    expect(labels).toEqual([
      // Field is annotation-only, so it stays component-scoped; the rest come
      // from the shared vocabulary the drawer renders from the common table.
      "LayerControl.style_label_field",
      "foliplus.label_style",
      "foliplus.label_format",
      "foliplus.label_collide",
    ]);
  });

  it("annotation color and size inputs are live and clamp on commit", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    const color = panelOf(item).querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item).querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").color).toBe("#00ff00");
    expect(renderLabels).toHaveBeenCalled();

    size.value = "18";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").size).toBe(18);

    size.value = "99";
    size.dispatchEvent(new Event("change", { bubbles: true }));
    expect(manager.annotation.getConfig("overlay1").size).toBe(32);
    expect(size.value).toBe("32");
  });

  it("annotation panel falls back when config color/size are empty", () => {
    manager.annotation.setConfig("overlay1", {
      ...CONST.DEFAULT_ANNOTATION,
      show: true,
      color: "",
      size: 0,
    });
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const color = panelOf(item).querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panelOf(item).querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ffffff");
    expect(size.value).toBe("11");
  });

  it("applyStyleLabelState restores the avoid-overlap switch from config", () => {
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    });
    ui.applyStyleLabelState();
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const collide = panelOf(item).querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    expect(collide.checked).toBe(false);
  });

  it("normalises non-string persisted values instead of trusting storage", () => {
    // localStorage is writable by anything on the page, so a field or format of
    // the wrong shape must not reach the config as-is.
    ui.labelConfigs = { overlay1: { show: true, field: 42, format: 7 } };

    ui.applyStyleLabelState();

    const cfg = manager.annotation.getConfig("overlay1");
    expect(cfg.field).toBe("");
    expect(cfg.format).toBe(NUMBER_FORMAT.AUTO);
  });

  it("shows auto for a persisted config with no format", () => {
    ui.fieldCache.set("overlay1", [{ name: "count", numeric: true }]);
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: "" as never,
    });
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(formatSelectOf(item).value).toBe(NUMBER_FORMAT.AUTO);
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

  // ─────────────────── labels toggle (default off) ───────────────────

  it("defaults the labels toggle off, with the body collapsed", () => {
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    expect(toggleOf(item).checked).toBe(false);
    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  it("reveals the body when switched on, leaving the picker on Auto", () => {
    // The picker's Auto entry is not a placeholder: switching the toggle on
    // leaves the field unresolved on purpose, so the layer keeps labelling
    // itself if its columns change. The auto rule itself (first numeric, else
    // first) is asserted in core/labelField.test.ts and below for the format row.
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    const toggle = toggleOf(item);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(false);
    expect(fieldSelectOf(item).value).toBe(AUTO_FIELD);
    expect(manager.annotation.getConfig("overlay1").field).toBe(AUTO_FIELD);
  });

  it("shows the number-format row for the field Auto resolves to", () => {
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    // Auto resolves to the numeric `count`, so the row is live even though the
    // select's own value is the empty sentinel.
    expect(fieldSelectOf(item).value).toBe(AUTO_FIELD);
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);
  });

  it("offers the auto entry first, then one option per field", () => {
    ui.fieldCache.set("overlay1", [
      { name: "name", numeric: false },
      { name: "count", numeric: true },
    ]);
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const options = Array.from(fieldSelectOf(item).options);
    expect(options.map(o => o.value)).toEqual([AUTO_FIELD, "name", "count"]);
    expect(options[0].textContent).toBe("LayerControl.style_label_field_auto");
    // A disabled placeholder, exactly like the heatmap's field_auto: it shows
    // the current state rather than offering itself as a choice. Reset is how
    // the field goes back to auto.
    expect(options[0].disabled).toBe(true);
    expect(options[1].disabled).toBe(false);
  });

  it("collapses the body again when the toggle goes back off", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const toggle = toggleOf(item);

    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(bodyOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  // ─────────────────── number-format row ───────────────────

  it("hides the number-format row for a non-numeric field on first render", () => {
    // Regression: the initial sync searched the row for a descendant row and
    // matched nothing, so the format dropdown shipped visible for string
    // fields — where comma / percent / int render exactly like auto.
    ui.fieldCache.set("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "name",
      format: NUMBER_FORMAT.AUTO,
    });

    ui.openStylePanel("overlay1");

    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(true);
  });

  it("shows the number-format row for a numeric field and flips it on switch", () => {
    ui.fieldCache.set("overlay1", [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ]);
    const item = findItem(ui, "overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });

    ui.openStylePanel("overlay1");
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);

    const field = fieldSelectOf(item);
    field.value = "name";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(true);

    field.value = "count";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(formatRowOf(item).classList.contains("foliplus-hidden")).toBe(false);
  });

  // ─────────────────── row drag vs panel controls ───────────────────

  it("a press inside the panel does not start a row reorder drag", () => {
    // The row is the drag source for any press in the row, the floating panel
    // included, and `dragstart` is dispatched on the row — a listener on the
    // panel can never see it (the panel is a descendant, never on the event's
    // path). So the verdict is recorded from the press and read here.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    panelOf(item)!.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    item.dispatchEvent(dragstart);

    expect(dragstart.defaultPrevented).toBe(true);
    expect(item.classList.contains(CONST.CLASSES.DRAGGING)).toBe(false);
    expect(ui.dragIdx).toBeNull();
  });

  it("a press outside the panel still starts the drag", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
    );
    const dragstart = new Event("dragstart", { bubbles: true, cancelable: true });
    item.dispatchEvent(dragstart);

    expect(dragstart.defaultPrevented).toBe(false);
    expect(item.classList.contains(CONST.CLASSES.DRAGGING)).toBe(true);
  });

  // ─────────────────── row cursor vs panel controls ───────────────────

  it("does not take the row cursor over for a press inside the panel", () => {
    // A press on a panel control belongs to the panel. The row-cursor takeover
    // calls row.focus(), and a native <select> popup is dismissed the moment it
    // loses focus — so the dropdown appeared to retract as it opened.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    item.classList.remove(CONST.CLASSES.FOCUSED);
    const focusSpy = vi.spyOn(item, "focus");

    fieldSelectOf(item).dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(focusSpy).not.toHaveBeenCalled();
    expect(item.classList.contains(CONST.CLASSES.FOCUSED)).toBe(false);
  });

  it("choosing a format updates the config", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    const format = panelOf(item).querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    format.value = NUMBER_FORMAT.COMMA;
    format.dispatchEvent(new Event("change", { bubbles: true }));

    expect(setConfig).toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").format).toBe(NUMBER_FORMAT.COMMA);
  });

  it("reset restores the default config and closes the panel", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.INT,
    });

    const btn = panelOf(item).querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The default config, plus the page's collide default injected by getConfig.
    expect(manager.annotation.getConfig("overlay1")).toEqual({
      ...CONST.DEFAULT_ANNOTATION,
      collide: true,
    });
    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("reset also restores collide (not just show/field/format)", () => {
    // Regression: DEFAULT_ANNOTATION alone omits collide, so a user-toggled
    // avoid-overlap switch used to survive Reset. defaultConfig() carries it.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    });

    const btn = panelOf(item).querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(manager.annotation.getConfig("overlay1").collide).toBe(true);
  });

  // ─────────────────── section headings + opacity ───────────────────

  it("renders label and layer section headings", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const headings = [...panel.querySelectorAll(".foliplus-section-heading")];
    expect(headings.length).toBe(2);
    expect(headings[0].textContent).toBe("LayerControl.section_label");
    expect(headings[1].textContent).toBe("LayerControl.section_layer");
  });

  it("suppresses the row's hover tooltip on the panel body", () => {
    // The panel is anchored inside the layer row, which carries a hover title
    // ("6 point layer"). An empty title on the panel container suppresses the
    // inherited tooltip so hovering the panel does not echo the row's text.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    expect(panel.getAttribute("title")).toBe("");
  });

  it("renders a range + number opacity pair defaulting to 100", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;
    expect(range).not.toBeNull();
    expect(number).not.toBeNull();
    expect(range.type).toBe("range");
    expect(range.min).toBe("0");
    expect(range.max).toBe("100");
    expect(range.step).toBe("5");
    expect(range.value).toBe("100");
    expect(number.value).toBe("100");
  });

  it("uses the shared form chrome for the row and the number field", () => {
    // Same recipe as the heatmap border row: one inline cell holding the
    // slider and a shared number input, so heights and radii cannot drift.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const control = panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_CONTROL}`)!;
    expect(control.classList.contains("foliplus-form-inline")).toBe(true);
    const number = panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_NUMBER}`)!;
    expect(number.classList.contains("foliplus-form-number-input")).toBe(true);
    expect((number as HTMLInputElement).min).toBe("0");
    expect((number as HTMLInputElement).max).toBe("100");
    expect((number as HTMLInputElement).step).toBe("5");
  });

  it("paints the slider accent fill to the current value", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    // Freshly opened → full width.
    expect(range.style.getPropertyValue("--opacity-fill")).toBe("100%");

    range.value = "35";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(range.style.getPropertyValue("--opacity-fill")).toBe("35%");
  });

  it("opacity input applies to the layer and persists", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "60";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(li.opacity).toBe(0.6);
    expect(ui.opacityMap.overlay1).toBe(0.6);
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;
    expect(number.value).toBe("60");
  });

  it("opacity number change syncs the range and clamps out-of-range values", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;

    number.value = "150";
    number.dispatchEvent(new Event("change", { bubbles: true }));
    expect(li.opacity).toBe(1);
    expect(ui.opacityMap.overlay1).toBeUndefined();
    expect(range.value).toBe("100");
  });

  it("canvas layers apply opacity via canvas.style.opacity", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn() },
    });
    const li = manager.layerRegistry.get("heat1")!;
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "40";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(li.canvas!.style.opacity).toBe("0.4");
    expect(li.opacity).toBe(0.4);
  });

  it("reset restores opacity to fully opaque and drops the persisted entry", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "30";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(ui.opacityMap.overlay1).toBeUndefined();
  });

  it("dragging back to fully opaque drops the provenance as well as the value", () => {
    // 100% is the declared default, so a drag back to it is a reset by another
    // route and must leave no override behind -- otherwise the record keeps a
    // marker with no value for it.
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "30";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(ui.userOverrides.overlay1).toContain("opacity");

    range.value = "100";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.opacityMap.overlay1).toBeUndefined();
    expect(ui.userOverrides.overlay1 ?? []).not.toContain("opacity");
  });

  it("reopening the panel seeds the opacity inputs from opacityMap", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const range = panelOf(item)!.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "25";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    ui.closeStylePanel(false);

    ui.openStylePanel("overlay1");
    const reopened = panelOf(item)!;
    expect(
      (reopened.querySelector(".foliplus-style-opacity-range") as HTMLInputElement)
        .value,
    ).toBe("25");
    expect(
      (reopened.querySelector(".foliplus-style-opacity-number") as HTMLInputElement)
        .value,
    ).toBe("25");
  });

  it("opacity 0 is kept in the map (only 1 is treated as default)", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const range = panelOf(item)!.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    range.value = "0";
    range.dispatchEvent(new Event("input", { bubbles: true }));

    expect(ui.opacityMap.overlay1).toBe(0);
    expect(li.opacity).toBe(0);
  });

  it("a valid number change syncs the range slider", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;

    number.value = "35";
    number.dispatchEvent(new Event("change", { bubbles: true }));

    expect(range.value).toBe("35");
    expect(li.opacity).toBe(0.35);
  });

  it("delegated Reset also restores LayerControl-owned opacity", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaults: () => ({ labelShow: true }),
    });
    const li = manager.layerRegistry.get("heat1")!;
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    range.value = "15";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(li.opacity).toBe(0.15);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(li.canvas!.style.opacity).toBe("1");
    expect(ui.opacityMap.heat1).toBeUndefined();
    expect(labelShowSetter).toHaveBeenCalledWith(true);
  });

  it("seeds the row at 100% when nothing stored an opacity yet", () => {
    // Neither the persisted map nor the registry entry carries a value — the
    // fresh-open path must still paint a full slider rather than NaN/empty.
    const li = manager.layerRegistry.get("overlay1")!;
    delete (li as { opacity?: number }).opacity;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;
    expect(range.value).toBe("100");
    expect(number.value).toBe("100");
    expect(range.style.getPropertyValue("--opacity-fill")).toBe("100%");
  });

  it("ignores an emptied number field while typing and restores it on commit", () => {
    // Clearing the field to retype reads as "" mid-edit; applying that would
    // parse as NaN and snap the layer transparent. Only the commit resolves it,
    // and it resolves to fully opaque — the invalid-commit default.
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;

    range.value = "45";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(li.opacity).toBe(0.45);

    number.value = "";
    number.dispatchEvent(new Event("input", { bubbles: true }));
    // Live pass: the layer keeps its opacity instead of going transparent.
    expect(li.opacity).toBe(0.45);

    number.dispatchEvent(new Event("change", { bubbles: true }));
    // Commit: fall back to fully opaque and rewrite both inputs.
    expect(li.opacity).toBe(1);
    expect(ui.opacityMap.overlay1).toBeUndefined();
    expect(number.value).toBe("100");
    expect(range.value).toBe("100");
    expect(range.style.getPropertyValue("--opacity-fill")).toBe("100%");
  });

  it("no-ops when the layer disappears between open and edit", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;

    // The row outlives its registry entry (a provider unregistered the layer).
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);
    expect(() => {
      range.value = "20";
      range.dispatchEvent(new Event("input", { bubbles: true }));
    }).not.toThrow();

    expect(ui.opacityMap.overlay1).toBeUndefined();
  });

  it("delegated panel renders the appearance row for labelSize alone", () => {
    // The color/size row is shared: a component that declares only the size
    // still gets it, with the swatch omitted.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 14 }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;

    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
  });

  it("deferred: an out-of-range entry applies only on commit, even with focus", () => {
    // Typing "150" toward "15" must not jump the layer to full first: the live
    // pass defers anything outside [0, 100] and the commit resolves it. The
    // commit also rewrites the field the caret is in, like the shared number
    // field does on blur.
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;

    range.value = "45";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(li.opacity).toBe(0.45);

    number.focus();
    number.value = "150";
    number.dispatchEvent(new Event("input", { bubbles: true }));
    // Live pass: still 45%, the slider has not moved.
    expect(li.opacity).toBe(0.45);
    expect(range.value).toBe("45");

    number.dispatchEvent(new Event("change", { bubbles: true }));
    expect(li.opacity).toBe(1);
    expect(number.value).toBe("100");
    expect(range.value).toBe("100");
    number.blur();
  });

  it("moves the slider while leaving the caret's own text alone", () => {
    // The field keeps what the user is typing (the slider rounds it), so the
    // caret does not jump to the end on every keystroke.
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const range = panel.querySelector(
      ".foliplus-style-opacity-range",
    ) as HTMLInputElement;
    const number = panel.querySelector(
      ".foliplus-style-opacity-number",
    ) as HTMLInputElement;

    number.focus();
    number.value = "37.6";
    number.dispatchEvent(new Event("input", { bubbles: true }));

    expect(li.opacity).toBe(0.38);
    expect(range.value).toBe("38");
    expect(range.style.getPropertyValue("--opacity-fill")).toBe("38%");
    expect(number.value).toBe("37.6");
    number.blur();
  });

  it("Reset survives a layer that vanished while the panel was open", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    expect(() =>
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
    ).not.toThrow();
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

  it("the ⋮ menu's Style item is enabled for pane-capable layers even without labels", () => {
    // R5: capability-driven gate. A layer whose surface reports opacity/zoomRange
    // capability gets the panel enabled — the opacity and zoomRange sliders are
    // useful even without label fields.
    ui.fieldCache.delete("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("disabled")).toBeNull();
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item is enabled once the layer has fields", () => {
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu li[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
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

    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);
  });

  it("drops a stale cached empty field list on LAYER_ITEM_COUNT_CHANGE", () => {
    // A layer registered with no labelable fields caches an empty list; a
    // runtime createLayers may later add features carrying properties, which
    // must un-stick the ⋮ menu's Style item.
    ui.fieldCache.delete("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(ui.fieldCache.get("overlay1")).toEqual([]);

    const fields = [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ];
    vi.spyOn(manager.annotation, "collectFields").mockReturnValue(fields);

    ui.onLayerItemCountChange("overlay1");

    expect(ui.fieldCache.has("overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(true);
  });

  it("re-renders a shown layer when its fields are invalidated", () => {
    // Dropping the cache is not enough: the drawn labels carry text baked from
    // the old fields while the picker would resolve a new auto field, so the
    // map and the panel would disagree until the user touched a control.
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer whose labels are off", () => {
    manager.annotation.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    });
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("invalidateFields drops a layer's cached list", () => {
    layerHasLabelFields(ui, "overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(true);

    // The delegate is the surface `manager.unregisterLayer` drives.
    ui.invalidateFields("overlay1");
    expect(ui.fieldCache.has("overlay1")).toBe(false);
  });

  it("keeps the field cache across close/reopen (count changes invalidate)", () => {
    // Closing the panel must not defeat the cache: re-collection on every
    // reopen walks every feature for nothing. The cache is dropped by
    // onLayerItemCountChange instead, when features actually change.
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(panelOf(item)).toBeUndefined();
    expect(ui.fieldCache.get("overlay1")).toEqual([{ name: "count", numeric: true }]);
  });

  // ─────────────────── persisted state ───────────────────

  it("applyStyleLabelState seeds a stored config for a layer that has none", () => {
    ui.labelConfigs = {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith("overlay1", {
      show: true,
      field: "count",
      color: CONST.DEFAULT_ANNOTATION.color,
      size: CONST.DEFAULT_ANNOTATION.size,
      format: NUMBER_FORMAT.AUTO,
      collide: true,
    });
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState falls back for non-typed stored color/size", () => {
    ui.labelConfigs = {
      overlay1: {
        show: true,
        field: "count",
        color: 42 as unknown as string,
        size: "big" as unknown as number,
        format: NUMBER_FORMAT.AUTO,
      },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith(
      "overlay1",
      expect.objectContaining({
        color: CONST.DEFAULT_ANNOTATION.color,
        size: CONST.DEFAULT_ANNOTATION.size,
      }),
    );
  });

  it("applyStyleLabelState normalizes a stored short hex color and clamps size", () => {
    ui.labelConfigs = {
      overlay1: {
        show: true,
        field: "count",
        color: "#abc",
        size: 99,
        format: NUMBER_FORMAT.AUTO,
      },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith(
      "overlay1",
      expect.objectContaining({
        color: "#aabbcc",
        size: 32,
      }),
    );
  });

  it("applyStyleLabelState leaves an already-configured layer alone", () => {
    // The persisted table is a seed, not a restore. Re-entering (a runtime
    // addControl re-fires CONTROL_ATTACHED) used to re-apply the load-time
    // snapshot over the live config, silently reverting whatever the user had
    // changed since the page loaded.
    manager.annotation.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    });
    ui.labelConfigs = {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
    expect(manager.annotation.getConfig("overlay1").show).toBe(false);
  });

  it("applyStyleLabelState renders a shown config whose field is still auto", () => {
    // `field: ""` is the Auto sentinel, not "no field" — a shown config with it
    // must still render (renderLabels resolves the auto pick).
    ui.labelConfigs = { overlay1: { show: true, field: "" } };
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips configs that are switched off", () => {
    ui.labelConfigs = { overlay1: { show: false, field: "count" } };
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");
    const clearLabels = vi.spyOn(manager.annotation, "clearLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).not.toHaveBeenCalled();
    // …and it clears instead: a stored `show: false` applied over labels left
    // on the map would leave the toggle reading off above visible labels.
    expect(clearLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips stale ids whose layers are gone", () => {
    ui.labelConfigs = {
      ghost: { show: true, field: "count", format: NUMBER_FORMAT.AUTO },
    };
    const setConfig = vi.spyOn(manager.annotation, "setConfig");
    const renderLabels = vi.spyOn(manager.annotation, "renderLabels");

    ui.applyStyleLabelState();

    // A stale id must not be written back into the live config map, or the
    // next annotations save would resurrect a removed layer.
    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  // ─────────────────── dismiss / drag edge cases ───────────────────

  it("a document-level mousedown (target = document) dismisses the panel", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    expect(panelOf(item)).not.toBeNull();

    // jsdom dispatching on `document` itself yields target === document,
    // which has no closest() — the handler must still dismiss the panel.
    document.dispatchEvent(new MouseEvent("mousedown"));

    expect(panelOf(item)).toBeUndefined();
    expect(ui.stylePanelLayerId).toBeNull();
  });

  it("does not observe dragstart at all (the browser targets the row)", () => {
    // Replaces an earlier assertion that dispatched `dragstart` *on the panel*
    // and checked it was prevented. The browser never does that: the row is the
    // drag source, so `dragstart` is dispatched on the row and its path runs to
    // the row's ancestors — the panel, a descendant, is never on it. That test
    // passed while the real bug (a press on the panel dragged the row) shipped.
    // The guard now lives on the press; see the two drag tests above.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    let seen = false;
    panel.addEventListener("dragstart", () => {
      seen = true;
    });

    item.dispatchEvent(
      new MouseEvent("dragstart", { bubbles: true, cancelable: true }),
    );

    expect(seen).toBe(false);
  });

  it("a change from an unrelated target is ignored and not stopped", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const content = panel.querySelector(".foliplus-panel-content") as HTMLElement;

    const event = new Event("change", { bubbles: true });
    Object.defineProperty(event, "stopPropagation", { value: vi.fn() });
    content.dispatchEvent(event);

    // No control matched → config untouched, event left to bubble.
    expect(manager.annotation.getConfig("overlay1").show).toBe(false);
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("opening the panel reflects an existing show:true config on the toggle", () => {
    manager.annotation.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    });
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it("the debounced annotation save invokes the config getter", () => {
    vi.useFakeTimers();
    try {
      const saveAnnotations = vi.spyOn(manager.persistence, "schedule");
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const panel = panelOf(item)!;
      const toggle = panel.querySelector(
        ".foliplus-style-toggle-input",
      ) as HTMLInputElement;
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      // Show alone leaves field empty; a label needs a field too — pick one
      // the way a user would, through the field select's own change branch.
      const field = panel.querySelector(
        ".foliplus-style-field-select",
      ) as HTMLSelectElement;
      field.value = "count";
      field.dispatchEvent(new Event("change", { bubbles: true }));

      // The persistence write is debounced (~100ms); only on flush does the
      // config getter (Object.fromEntries over configEntries) execute.
      vi.advanceTimersByTime(200);

      expect(saveAnnotations).toHaveBeenCalled();
      const fields = saveAnnotations.mock.calls.at(-1)![0] as {
        annotations: () => Record<string, unknown>;
      };
      expect(fields.annotations()).toEqual({
        overlay1: {
          show: true,
          field: "count",
          color: CONST.DEFAULT_ANNOTATION.color,
          size: CONST.DEFAULT_ANNOTATION.size,
          format: NUMBER_FORMAT.AUTO,
          collide: true,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("annotation format labels fall back to the raw key when the translator returns empty", () => {
    const item = findItem(ui, "overlay1");
    const realUnderscore = ui._;
    ui._ = (key: string) =>
      key.startsWith("foliplus.label_format_") ? "" : realUnderscore(key);

    ui.openStylePanel("overlay1");

    const opts = panelOf(item)!.querySelectorAll(
      ".foliplus-style-format-select option",
    );
    expect([...opts].map(o => o.textContent)).toEqual([
      "auto",
      "int",
      "comma",
      "percent",
    ]);

    ui._ = realUnderscore;
  });

  // ─────────────────── delegated style panel (third-party) ───────────────────

  it("delegated panel with only labelShow + labelFormat omits color/size row", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-format-select")).not.toBeNull();
  });

  it("delegated format labels fall back to the raw key when the translator returns empty", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    const realUnderscore = ui._;
    ui._ = (key: string) =>
      key.startsWith("foliplus.label_format_") ? "" : realUnderscore(key);

    ui.openStylePanel("heat1");

    // The || f fallback made the option text the raw format key.
    const opts = panelOf(item)!.querySelectorAll(
      ".foliplus-style-format-select option",
    );
    expect([...opts].map(o => o.textContent)).toEqual([
      "auto",
      "int",
      "comma",
      "percent",
    ]);

    ui._ = realUnderscore;
  });

  it("delegated panel renders a format select when labelFormat setter is present", () => {
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "comma" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: labelFormatSetter },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const formatSelect = panel.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect).not.toBeNull();
    expect(formatSelect.value).toBe("comma");
    const opts = Array.from(formatSelect.options).map(o => o.value);
    expect(opts).toEqual(Object.values(NUMBER_FORMAT));
  });

  it("delegated panel renders color and size inputs when those setters exist", () => {
    const labelColorSetter = vi.fn();
    const labelSizeSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: "#ff0000",
        labelSize: 14,
        labelFormat: "auto",
      }),
      styleSetters: {
        labelShow: vi.fn(),
        labelColor: labelColorSetter,
        labelSize: labelSizeSetter,
        labelFormat: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const color = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ff0000");
    expect(size.value).toBe("14");

    color.value = "#00ff00";
    color.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelColorSetter).toHaveBeenCalledWith("#00ff00");

    size.value = "18";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelSizeSetter).toHaveBeenCalledWith(18);
  });

  it("delegated size input clamps out-of-range values on commit, like the heatmap panel", () => {
    const labelSizeSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 11 }),
      styleSetters: { labelShow: vi.fn(), labelSize: labelSizeSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const size = panelOf(item)!.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    size.value = "99";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    expect(labelSizeSetter).not.toHaveBeenCalled();

    size.dispatchEvent(new Event("change", { bubbles: true }));
    expect(size.value).toBe("32");
    expect(labelSizeSetter).toHaveBeenCalledWith(32);
  });

  it("delegated panel falls back to defaults when provider returns non-typed color/size", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelColor: 42, labelSize: "big" }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const color = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const size = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(color.value).toBe("#ffffff");
    expect(size.value).toBe("11");
  });

  it("delegated panel returns null when setters declare only unknown keys", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ field: "count" }),
      styleSetters: { field: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)).toBeUndefined();
  });

  it("LAYER_STYLE_CHANGE skips non-typed color/size provider values on refresh", () => {
    let color: unknown = "#ff0000";
    let size: unknown = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;

    color = 42;
    size = "big";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    // Non-typed provider values leave the inputs alone.
    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("12");
  });

  it("LAYER_STYLE_CHANGE skips color/size overwrite when the user is editing them", () => {
    let color = "#ff0000";
    let size = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    colorEl.focus();

    color = "#00ff00";
    size = 20;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("20");
  });

  it("delegated panel renders only the color input when size setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).toBeNull();
  });

  it("delegated panel renders only the size input when color setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelSize: 14 }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    expect(panel.querySelector(".foliplus-style-label-color-input")).toBeNull();
    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
  });

  it("LAYER_STYLE_CHANGE refreshes color and size inputs", () => {
    let color = "#ff0000";
    let size = 12;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelColor: color,
        labelSize: size,
      }),
      styleSetters: { labelShow: vi.fn(), labelColor: vi.fn(), labelSize: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorEl = panel.querySelector(
      ".foliplus-style-label-color-input",
    ) as HTMLInputElement;
    const sizeEl = panel.querySelector(
      ".foliplus-style-label-size-input",
    ) as HTMLInputElement;
    expect(colorEl.value).toBe("#ff0000");
    expect(sizeEl.value).toBe("12");

    color = "#00ff00";
    size = 20;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorEl.value).toBe("#00ff00");
    expect(sizeEl.value).toBe("20");
  });

  it("delegated panel omits the format select when labelFormat setter is absent", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-format-select")).toBeNull();
  });

  it("delegated format select dispatches to styleSetters.labelFormat", () => {
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: labelFormatSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    formatSelect.value = "percent";
    formatSelect.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelFormatSetter).toHaveBeenCalledWith("percent");
  });

  it("delegated panel refreshes format select on LAYER_STYLE_CHANGE", () => {
    let currentFormat = "auto";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: currentFormat }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("auto");

    currentFormat = "int";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(formatSelect.value).toBe("int");
  });

  it("delegated panel hides format select under the label body when labels are off", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelFormat: "auto" }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const body = panel.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(true);
    expect(body.querySelector(".foliplus-style-format-select")).not.toBeNull();
  });

  it("delegated Reset includes labelFormat when published in styleDefaults", () => {
    const labelShowSetter = vi.fn();
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "comma" }),
      styleSetters: { labelShow: labelShowSetter, labelFormat: labelFormatSetter },
      styleDefaults: () => ({ labelShow: false, labelFormat: "auto" }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelFormatSetter).toHaveBeenCalledWith("auto");
  });

  it("layerHasStyleDelegation is true only for layers with styleSetters", () => {
    expect(layerHasStyleDelegation(ui, "overlay1")).toBe(false);

    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    expect(layerHasStyleDelegation(ui, "heat1")).toBe(true);
  });

  it("delegated panel renders only the controls the component declared", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const showToggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    const collideToggle = panel.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // labelShow true → checked; labelCollide false → unchecked.
    expect(showToggle.checked).toBe(true);
    expect(collideToggle.checked).toBe(false);
    // Aggregation field is data config on the component's own panel — never
    // delegated into the drawer.
    expect(panel.querySelector(".foliplus-style-field-select")).toBeNull();
    // The shared renderer emits controls only, so the panel still owns the
    // section split: LABEL above the shared root, LAYER above the opacity row.
    const headings = [...panel.querySelectorAll(".foliplus-section-heading")];
    expect(headings.map(h => h.textContent)).toEqual([
      "LayerControl.section_label",
      "LayerControl.section_layer",
    ]);
    // Document order, not just presence: each heading must precede its section.
    const order = [...panel.querySelectorAll("*")];
    expect(order.indexOf(headings[0])).toBeLessThan(
      order.indexOf(showToggle as unknown as Element),
    );
    expect(order.indexOf(headings[1])).toBeLessThan(
      order.indexOf(panel.querySelector(".foliplus-style-opacity-range")!),
    );
  });

  it("delegated panel omits the field select even when field setter is present", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, field: "count" }),
      styleSetters: { labelShow: vi.fn(), field: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-field-select")).toBeNull();
  });

  it("delegated change dispatches to styleSetters", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).toHaveBeenCalledWith(false);
  });

  it("delegated panel refreshes when LAYER_STYLE_CHANGE fires for its layer", () => {
    const labelShowSetter = vi.fn();
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    // Simulate the component's own panel flipping the value and emitting.
    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(toggle.checked).toBe(false);
  });

  it("delegated panel does not overwrite an input being edited", () => {
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.focus();

    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    // The user is editing this input — the remote value must not overwrite it.
    expect(toggle.checked).toBe(true);
  });

  it("closeStylePanel unsubscribes from LAYER_STYLE_CHANGE", () => {
    const offSpy = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    ui.openStylePanel("heat1");
    expect(ui.styleUnsubscribe).not.toBeNull();

    // Capture the unsubscribe and verify it is called on close.
    const unsub = ui.styleUnsubscribe!;
    ui.styleUnsubscribe = () => {
      offSpy();
      unsub();
    };
    ui.closeStylePanel(false);

    expect(offSpy).toHaveBeenCalled();
    expect(ui.styleUnsubscribe).toBeNull();
  });

  it("empty styleSetters does not enable the delegated panel", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: {},
    });
    expect(layerHasStyleDelegation(ui, "heat1")).toBe(false);
  });

  it("delegated panel collapses body when label toggle is off", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelCollide: true }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const body = panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(true);
  });

  it("delegated panel expands body when label toggle is flipped on", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false, labelCollide: true }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    const body = panelOf(item)!.querySelector(".foliplus-style-body") as HTMLElement;
    expect(body.classList.contains("foliplus-hidden")).toBe(false);
    expect(labelShowSetter).toHaveBeenCalledWith(true);
  });

  it("delegated change dispatches labelCollide to styleSetters", () => {
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: true }),
      styleSetters: { labelShow: vi.fn(), labelCollide: labelCollideSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    collideToggle.checked = false;
    collideToggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelCollideSetter).toHaveBeenCalledWith(false);
  });

  it("LAYER_STYLE_CHANGE updates the collide toggle from the provider", () => {
    let currentCollide = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: currentCollide }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    expect(collideToggle.checked).toBe(true);

    currentCollide = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(collideToggle.checked).toBe(false);
  });

  it("delegated change handler ignores unrecognized controls", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Dispatch a change on a plain div inside the panel — no known control
    // class matches, so the handler returns early without calling any setter.
    const bogus = document.createElement("div");
    panelOf(item)!.appendChild(bogus);
    bogus.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
  });

  it("delegated change handler ignores a stray field select", () => {
    const labelShowSetter = vi.fn();
    const fieldSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, field: "count" }),
      styleSetters: { labelShow: labelShowSetter, field: fieldSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // The drawer no longer renders a field select, but a third-party layer
    // could still register `field`. A stray change must not reach the setter.
    const stray = document.createElement("select");
    stray.className = "foliplus-form-select foliplus-style-field-select";
    panelOf(item)!.appendChild(stray);
    stray.value = "sum";
    stray.dispatchEvent(new Event("change", { bubbles: true }));

    expect(fieldSetter).not.toHaveBeenCalled();
  });

  // ─────────────────── delegated reset (Python CONF defaults) ───────────────────

  it("delegated panel hides Reset when the layer supplies no styleDefaults", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-reset-btn")).toBeNull();
  });

  it("delegated panel renders Reset when styleDefaults is present", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaults: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("LayerControl.style_reset");
  });

  it("delegated Reset calls each setter with its styleDefaults value and closes", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
      styleDefaults: () => ({ labelShow: false, labelCollide: true }),
    });
    const item = findItem(ui, "heat1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Python CONF defaults — never the live / persisted values.
    expect(labelShowSetter).toHaveBeenCalledWith(false);
    expect(labelCollideSetter).toHaveBeenCalledWith(true);
    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("delegated Reset skips setters with no matching default", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: true }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
      styleDefaults: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelShowSetter).toHaveBeenCalledWith(false);
    expect(labelCollideSetter).not.toHaveBeenCalled();
  });

  it("delegated panel tolerates a missing styleProvider (empty values)", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const showToggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    const collideToggle = panelOf(item)!.querySelector(
      ".foliplus-style-collide-input",
    ) as HTMLInputElement;
    // Empty provider → both toggles read as off / collide-on default.
    expect(showToggle.checked).toBe(false);
    expect(collideToggle.checked).toBe(true);
  });

  it("delegated panel with only labelCollide still renders (no show row)", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelCollide: true }),
      styleSetters: { labelCollide: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    expect(panelOf(item)!.querySelector(".foliplus-style-toggle-input")).toBeNull();
    expect(
      panelOf(item)!.querySelector(".foliplus-style-collide-input"),
    ).not.toBeNull();
  });

  it("delegated Reset closes cleanly when styleDefaults returns undefined", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaults: () => undefined as unknown as Record<string, unknown>,
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // No default keys → no setter call, but the panel still closes.
    expect(labelShowSetter).not.toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
  });

  it("LAYER_STYLE_CHANGE for a different layer id is ignored", () => {
    let currentLabelShow = true;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: currentLabelShow }),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    currentLabelShow = false;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "other-layer" },
    );

    expect(toggle.checked).toBe(true);
  });

  it("LAYER_STYLE_CHANGE bails when styleProvider returns nothing", () => {
    let provide: () => Record<string, unknown> | undefined = () => ({
      labelShow: true,
    });
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => provide(),
      styleSetters: { labelShow: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    provide = () => undefined;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(toggle.checked).toBe(true);
  });

  it("delegated Reset no-ops when styleSetters is cleared after open", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaults: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Simulate the layer being torn down between open and Reset.
    const li = manager.layerRegistry.get("heat1")!;
    (li as { styleSetters: unknown }).styleSetters = null;

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
    expect(panelOf(item)).toBeUndefined();
  });

  it("delegated change no-ops when styleSetters is cleared after open", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const li = manager.layerRegistry.get("heat1")!;
    (li as { styleSetters: unknown }).styleSetters = null;

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(labelShowSetter).not.toHaveBeenCalled();
  });

  it("dispatches into a layer re-registered while its drawer is open", () => {
    const firstSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: firstSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    // Re-registering upserts a fresh LayerInfo object in place of the old one.
    // The drawer must resolve through the registry rather than the entry it
    // captured at render time — a captured entry would keep driving a layer
    // that is no longer registered.
    const secondSetter = vi.fn();
    const current = manager.layerRegistry.get("heat1")!;
    manager.layerRegistry.upsert({
      ...current,
      styleSetters: { labelShow: secondSetter },
    } as never);

    const toggle = panelOf(item)!.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));

    expect(secondSetter).toHaveBeenCalledWith(false);
    expect(firstSetter).not.toHaveBeenCalled();
  });

  it("delegated format select falls back to auto for a non-string provider value", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: 42 }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("auto");
  });

  it("LAYER_STYLE_CHANGE resets format select to auto for a non-string value", () => {
    let currentFormat: unknown = "comma";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: currentFormat }),
      styleSetters: { labelShow: vi.fn(), labelFormat: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const formatSelect = panelOf(item)!.querySelector(
      ".foliplus-style-format-select",
    ) as HTMLSelectElement;
    expect(formatSelect.value).toBe("comma");

    currentFormat = 99;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(formatSelect.value).toBe("auto");
  });
});
