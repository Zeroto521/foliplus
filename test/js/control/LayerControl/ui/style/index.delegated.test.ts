// test/js/control/LayerControl/ui/style/index.delegated — the delegated style panel.
import { findItem, initFixture } from "../fixture.js";
import { keepBubble, pathify, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { styleCapability } from "#control/LayerControl/ui/style/index.js";

describe("LayerUI style panel", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  beforeEach(() => {
    restoreBubble();
    ({ manager, ui, map } = initFixture());
    ui.listPanel.foldedRoles = {};
    seedIntentMap(ui, "visible", {});
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    // Seed the field cache so the panel builds: collectFields walks the
    // layer's leaves, and the fixture's data layer has none. `count` is a
    // number, which is what makes the number-format row reachable.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    // The Label section's gate is the surface's label capability — a
    // probe over real feature data, which this fixture layer has none of.
    // The field cache supplies the picker's options; this bit supplies the
    // section's right to render — the two dials the old `hasLabel` gate
    // read from a single place.
    const li = manager.layerRegistry.get("overlay1")!;
    const surface = manager.surfaceFor(li) as unknown as {
      capabilities: Record<string, unknown>;
    };
    surface.capabilities = { ...surface.capabilities, label: "pane" };
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    keepBubble();
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

  it("delegated Reset includes labelFormat when published in styleDefaultsProvider", () => {
    const labelShowSetter = vi.fn();
    const labelFormatSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelFormat: "comma" }),
      styleSetters: { labelShow: labelShowSetter, labelFormat: labelFormatSetter },
      styleDefaultsProvider: () => ({ labelShow: false, labelFormat: "auto" }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(labelFormatSetter).toHaveBeenCalledWith("auto");
  });

  it("styleDelegation is true only for layers with styleSetters", () => {
    expect(styleCapability(ui, "overlay1").styleDelegation).toBe(false);

    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    expect(styleCapability(ui, "heat1").styleDelegation).toBe(true);
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
    // The shared renderer emits controls only, so the panel owns its own
    // ordering: the Layer rows (which LayerControl adds) come before the Label
    // rows (which the component delegated). No heading carries that split any
    // more — document order does.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    const order = [...panel.querySelectorAll("*")];
    expect(
      order.indexOf(panel.querySelector(".foliplus-style-opacity-track")!),
    ).toBeLessThan(order.indexOf(showToggle as unknown as Element));
  });

  it("gives the Layer section to a delegated layer that publishes only border setters", () => {
    // A styleSetters layer with neither an opacity carrier nor a zoom-range
    // carrier: the border row is LayerControl-owned, so the Layer section must
    // open for it — otherwise it renders orphaned under the label heading.
    manager.registerLayer({
      id: "borderOnly",
      name: "BorderOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, borderColor: "#abcdef" }),
      styleSetters: {
        labelShow: vi.fn(),
        borderColor: vi.fn(),
      },
    });
    // Each row answers to its own capability, and `detectCapabilities` never
    // emits a surface that is opacity-less yet zoom-range-carrying — a canvas
    // declares `zoomRange: "pane"`, so the sparse case needs both forced off.
    const li = manager.layerRegistry.get("borderOnly")!;
    manager.surfaceFor(li).capabilities.opacity = "none";
    manager.surfaceFor(li).capabilities.zoomRange = "none";

    const item = findItem(ui, "borderOnly");
    ui.openStylePanel("borderOnly");
    const panel = panelOf(item)!;

    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).toBeNull();
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`)).toBeNull();
    // No group headings — the Layer rows still render on their own.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    expect(panel.querySelector("input[type=color]")).not.toBeNull();
  });

  it("delegated panel with vector geometry skips fill/border — the component redraws them", () => {
    // A measure-like layer: vector geometry (polygon) that detects fill/stroke
    // as "native", but the component only delegates label style (labelShow,
    // labelCollide) — no border/fill setters. The DIM_ORDER sweep must skip
    // fill and border (the vector setStyle write is unreliable against a
    // component that redraws its own geometry), keeping only opacity and
    // zoomRange (LayerControl-owned).
    const leaf = pathify({
      options: { color: "#3388ff", weight: 2, fillColor: "#3388ff", fillOpacity: 0.2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
    manager.registerLayer({
      id: "measure1",
      name: "Measure",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => {
          fn(leaf);
        }),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: vi.fn(), labelCollide: vi.fn() },
    });
    ui.runtimeStore.setFields("measure1", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "measure1");
    ui.openStylePanel("measure1");
    const panel = panelOf(item)!;

    // No fill or border rows — the delegated drawer skips both.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_FILL_ROW}`)).toBeNull();
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_BORDER_ROW}`)).toBeNull();

    // Opacity and zoomRange are LayerControl-owned — they survive.
    expect(panel.querySelector(`.${CONST.CLASSES.STYLE_OPACITY_TRACK}`)).not.toBeNull();
    expect(
      panel.querySelector(`.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`),
    ).not.toBeNull();

    // The Layer rows still render — opacity and zoomRange above are the proof.
    // What is gone is the group heading that used to introduce them.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
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
    expect(ui.overlayPanel.styleUnsubscribe).not.toBeNull();

    // Capture the unsubscribe and verify it is called on close.
    const unsub = ui.overlayPanel.styleUnsubscribe!;
    ui.overlayPanel.styleUnsubscribe = () => {
      offSpy();
      unsub();
    };
    ui.closeStylePanel(false);

    expect(offSpy).toHaveBeenCalled();
    expect(ui.overlayPanel.styleUnsubscribe).toBeNull();
  });

  it("empty styleSetters does not enable the delegated panel", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: {},
    });
    expect(styleCapability(ui, "heat1").styleDelegation).toBe(false);
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
});
