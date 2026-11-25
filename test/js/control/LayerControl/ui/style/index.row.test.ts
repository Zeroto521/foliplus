// test/js/control/LayerControl/ui/style/index.row — rows, sliders, opacity and border/zoom-range gates.
import { GridLayer, findItem, initFixture, installLeafletGlobals } from "../fixture.js";
import { fillPct, keepBubble, pathify, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getLayerAlpha } from "#core/layer/index.js";
import { ensureModes } from "#core/lifecycle/index.js";
import { sliderOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { getIntent, seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { renderInitialList } from "#control/LayerControl/ui/listPanel/list.js";
import { closeStylePanel } from "#control/LayerControl/ui/style/index.js";

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

  // Every FORM_ROW whose label is the border label — counts a border row
  // regardless of whether the vector row or the delegated drawer's row built it.
  const borderRows = (panel: HTMLElement): HTMLElement[] =>
    Array.from(panel.querySelectorAll<HTMLElement>(".foliplus-form-row")).filter(
      row => row.querySelector(".foliplus-form-label")?.textContent === ui.T("border"),
    );
  // ─────────────────── row groups + opacity ───────────────────

  it("renders the layer and label rows with no group headings", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    // Headings are gone; the two groups are told apart by document order.
    expect(panel.querySelectorAll(".foliplus-section-heading")).toHaveLength(0);
    const order = [...panel.querySelectorAll("*")];
    const layer = panel.querySelector(".foliplus-style-opacity-track");
    const label = panel.querySelector(".foliplus-style-toggle-input");
    expect(layer).not.toBeNull();
    expect(label).not.toBeNull();
    expect(order.indexOf(layer!)).toBeLessThan(order.indexOf(label as Element));
    // The label dimension's row is one wrapper (toggle + body) — the
    // structural hook the Label content is selected by.
    const labelBlock = panel.querySelector(`.${CONST.CLASSES.STYLE_LABEL_SECTION}`);
    expect(labelBlock).not.toBeNull();
    expect(
      labelBlock!.querySelector(`.${CONST.CLASSES.STYLE_TOGGLE_INPUT}`),
    ).not.toBeNull();
  });

  it("finishes sliders before a list rebuild", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const finish = vi.spyOn(sliderOf(host)!, "finish");
    // A reorder / fold rebuild clears the container without closing the panel.
    renderInitialList(ui);
    expect(finish).toHaveBeenCalled();
  });

  it("finishes sliders when their layer is unregistered", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const finish = vi.spyOn(sliderOf(host)!, "finish");
    manager.unregisterLayer("overlay1");
    expect(finish).toHaveBeenCalled();
  });

  it("finishes every slider before the panel is removed", () => {
    // closing mid-drag is a commit boundary: the pointer already set the
    // value, so the session must end (and emit change) before remove().
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;
    const finish = vi.spyOn(slider, "finish");
    closeStylePanel(ui, false);
    expect(finish).toHaveBeenCalledTimes(1);
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

  it("paints the slider accent fill to the current value", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const fill = panel.querySelector(".foliplus-slider-fill") as HTMLElement;
    // Freshly opened → full width.
    expect(fillPct(fill)).toBeCloseTo(1);

    sliderOf(host)!.setValue(35);

    expect(fillPct(fill)).toBeCloseTo(0.35);
  });

  it("does not rewrite the layer when the committed opacity is unchanged", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const li = manager.layerRegistry.get("overlay1")!;
    // The layer changes outside the panel while it is open; moving the thumb
    // to that same value must sync the control without a second write.
    li.opacity = 0.5;
    sliderOf(host)!.setValue(50);
    expect(li.opacity).toBe(0.5);
    expect(sliderOf(host)!.value).toBe(50);
  });

  it("covers the opacity end dots only as far as the thumb reaches", () => {
    // Single thumb: the covered span is [min, value]. The 0 dot is accent
    // from the start (the layer is painted from 0); the 100 dot is accent
    // only at full opacity.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const dotAt = (at: string): HTMLElement =>
      host.querySelector(`.foliplus-slider-dot[data-at="${at}"]`) as HTMLElement;

    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(true);

    sliderOf(host)!.setValue(35);
    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(false);

    sliderOf(host)!.setValue(0);
    expect(dotAt("0").classList.contains("foliplus-slider-dot-covered")).toBe(true);
    expect(dotAt("100").classList.contains("foliplus-slider-dot-covered")).toBe(false);
  });

  it("canvas layers with opacityBake 'redraw' keep CSS on the slider commit", () => {
    // Heatmap mode (default): CSS live feedback, bake deferred to redraw.
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
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(40);

    // CSS mode for live feedback; layerAlpha is stored for the next redraw.
    expect(li.canvas!.style.opacity).toBe("0.4");
    expect(getLayerAlpha(li.canvas)).toBeCloseTo(0.4);
    expect(li.opacity).toBe(0.4);
  });

  it("canvas layers with opacityBake 'commit' bake and clear CSS", () => {
    // Color-face mode: bake on the commit itself, CSS cleared.
    manager.registerLayer({
      id: "color1",
      name: "Color",
      canvas: document.createElement("canvas"),
      opacityBake: "commit",
    });
    const li = manager.layerRegistry.get("color1")!;
    const item = findItem(ui, "color1");
    ui.openStylePanel("color1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(40);

    expect(getLayerAlpha(li.canvas)).toBeCloseTo(0.4);
    expect(li.canvas!.style.opacity).toBe("");
    expect(li.opacity).toBe(0.4);
  });

  it("commit mode fires onOpacity when the layer registered one (branch cover)", () => {
    const onOpacity = vi.fn();
    manager.registerLayer({
      id: "color2",
      name: "Color2",
      canvas: document.createElement("canvas"),
      opacityBake: "commit",
      onOpacity,
    });
    const item = findItem(ui, "color2");
    ui.openStylePanel("color2");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(50);

    expect(onOpacity).toHaveBeenCalledWith(0.5);
  });

  it("reset restores opacity to fully opaque and drops the persisted entry", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(30);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
  });

  it("dragging back to fully opaque drops the provenance as well as the value", () => {
    // 100% is the declared default, so a drag back to it is a reset by another
    // route and must leave no override behind -- otherwise the record keeps a
    // marker with no value for it.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;

    slider.setValue(30);
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(true);

    slider.setValue(100);

    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
    expect(ui.intentStore.isUserSet("overlay1", "opacity")).toBe(false);
  });

  it("opacity 0 is kept in the map (only 1 is treated as default)", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const host = panelOf(item)!.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(0);

    expect(getIntent(ui, "overlay1", "opacity")).toBe(0);
    expect(li.opacity).toBe(0);
  });

  it("delegated Reset also restores LayerControl-owned opacity", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const li = manager.layerRegistry.get("heat1")!;
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(15);
    expect(li.opacity).toBe(0.15);

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(li.opacity).toBe(1);
    expect(getLayerAlpha(li.canvas)).toBe(1);
    expect(li.canvas!.style.opacity).toBe("1");
    expect(getIntent(ui, "heat1", "opacity")).toBeUndefined();
    expect(labelShowSetter).toHaveBeenCalledWith(true);
  });

  it("no-ops when the layer disappears between open and edit", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    // The row outlives its registry entry (a provider unregistered the layer).
    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);
    expect(() => {
      sliderOf(host)!.setValue(20);
    }).not.toThrow();

    expect(getIntent(ui, "overlay1", "opacity")).toBeUndefined();
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

  it("Reset survives a layer that vanished while the panel was open", () => {
    const item = findItem(ui, "overlay1");
    manager.label.setConfig("overlay1", { show: true, field: "count" } as any);
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
    const panel = panelOf(item)!;

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(panelOf(item)).toBeUndefined();
  });

  it("header click closes the panel without bubbling to the map", () => {
    // A press on the header (or the × inside it) must not also become a map
    // click: closing the panel removes it mid-dispatch, so the click would
    // otherwise keep walking its original path with no live control ancestor
    // and land on the map (the same guarantee as the ⋮ menu — #807).
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const bubbled = vi.fn();
    item.addEventListener("click", bubbled);

    panel
      .querySelector(".foliplus-panel-header")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The panel still closes…
    expect(panelOf(item)).toBeUndefined();
    // …and the press was swallowed, never reaching the row / map.
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("Escape closes an open style panel and returns focus to its row", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;

    ui.openStylePanel("overlay1");
    const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.focus();

    // Real keydown: the overlay registry owns Escape now.
    checkbox.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      }),
    );

    expect(panelOf(item)).toBeUndefined();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("layerCanOpacity declines a 'none' carrier: no opacity row is built", () => {
    // The `capabilities.opacity !== "none"` half of the guard. A layer whose
    // icons live in a shared pane we do not own (MarkerCluster) has no honest
    // opacity write — showing a slider would persist a value nothing applies.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    vi.spyOn(manager, "surfaceFor").mockReturnValue({
      capabilities: { opacity: "none", zoomRange: "none" },
      paneNames: [],
      geometryType: () => "point",
    } as unknown as ReturnType<typeof manager.surfaceFor>);

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-opacity-track")).toBeNull();
    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).toBeNull();
  });

  it("builds one border row for a vector layer, before the opacity row", () => {
    // The fixture's default overlay1 layer is a bare group with no setStyle
    // leaves — border needs at least one such leaf (the border gate), so register a
    // real vector for this test.
    const leaf = pathify({
      options: { color: "#3388ff", weight: 2 },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
    manager.registerLayer({
      id: "border1",
      name: "Border",
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
    });
    ui.runtimeStore.setFields("border1", [{ name: "count", numeric: true }]);
    const item = findItem(ui, "border1");
    ui.openStylePanel("border1");
    const panel = panelOf(item)!;

    expect(borderRows(panel)).toHaveLength(1);
    const row = panel.querySelector(
      ".foliplus-style-border-detail .foliplus-style-border-row",
    ) as HTMLElement;
    expect(row.querySelector(".foliplus-style-border-color-input")).not.toBeNull();
    const width = row.querySelector(
      ".foliplus-style-border-weight-input",
    ) as HTMLInputElement;
    expect(width.min).toBe("0");
    expect(width.max).toBe("10");
    expect(width.step).toBe("0.5");

    // Layer section order: fill, border, opacity, zoom range. The classes live
    // on the rows themselves, so both the row and its descendants are checked.
    const rows = Array.from(panel.querySelectorAll(".foliplus-form-row"));
    const index = (sel: string) =>
      rows.findIndex(row => row.matches(sel) || row.querySelector(sel) !== null);
    expect(index(".foliplus-style-border-row")).toBeLessThan(
      index(".foliplus-style-opacity-track"),
    );
    expect(index(".foliplus-style-opacity-track")).toBeLessThan(
      index(".foliplus-style-zoom-range-row"),
    );
  });

  it("renders both the border and the fill row in the layer section, in order", () => {
    // Border and fill landed on separate branches. Both rows must survive the
    // merge in one panel, and the two color axes sit adjacent — a slider
    // between them would read as two different concerns rather than as one
    // painted shape. Designed order: fill, border, opacity, zoom range.
    installLeafletGlobals();
    const leaves = [new L.Polygon(), new L.Polygon()] as L.Polygon[];
    leaves.forEach(leaf => {
      leaf.options = {
        color: "#000000",
        weight: 2,
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
      };
      leaf.setStyle = vi.fn();
    });
    manager.registerLayer({
      id: "poly1",
      name: "Poly",
      role: "overlay",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => leaves.forEach(fn)),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: vi.fn(() => ({ lat: 0, lng: 0 })),
          getNorthEast: vi.fn(() => ({ lat: 1, lng: 1 })),
        })),
      },
    });
    const p1 = new window.L.Polygon();
    console.log(
      "POLY_PROBE",
      p1 instanceof window.L.Polygon,
      p1 instanceof window.L.Path,
      typeof window.L.Path,
      Object.getPrototypeOf(window.L.Polygon.prototype) === window.L.Path.prototype,
    );
    console.log(
      "POLY1_CAPS",
      JSON.stringify(
        manager.surfaceFor(manager.layerRegistry.get("poly1")!).capabilities,
      ),
    );
    ui.runtimeStore.setFields("poly1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "poly1");
    ui.openStylePanel("poly1");
    const panel = panelOf(item)!;

    const rows = Array.from(panel.querySelectorAll(".foliplus-form-row"));
    const index = (sel: string) =>
      rows.findIndex(row => row.matches(sel) || row.querySelector(sel) !== null);
    const positions = [
      index(".foliplus-style-fill-row"),
      index(".foliplus-style-border-row"),
      index(".foliplus-style-opacity-track"),
      index(".foliplus-style-zoom-range-row"),
    ];
    console.log("POSITIONS", JSON.stringify(positions));
    expect(positions.every(pos => pos >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]);
    expect(positions[1]).toBeLessThan(positions[2]);
    expect(positions[2]).toBeLessThan(positions[3]);
  });

  it("never builds the vector border row for a delegated layer — one border row total", () => {
    // The delegated drawer skips `border` in the DIM_ORDER sweep, so the
    // vector border row cannot render alongside the drawer's own border row.
    // The drawer's border row comes from the styleSetters path (setters
    // publishing borderWeight / borderColor), not the registry.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        borderColor: "#000000",
        borderWeight: 2,
      }),
      styleSetters: { borderColor: vi.fn(), borderWeight: vi.fn() },
      styleDefaultsProvider: () => ({
        labelShow: true,
        borderColor: "#000000",
        borderWeight: 2,
      }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    const panel = panelOf(item)!;

    expect(panel.querySelectorAll(".foliplus-style-border-row")).toHaveLength(0);
    expect(borderRows(panel)).toHaveLength(1);
  });

  it("panel and delegated share one gate sweep — delegated rows match panel Layer rows minus vector-only dims", () => {
    // Single gatedRows implementation behind both consumers: the rows the
    // delegated drawer renders through the registry sweep must be exactly
    // the rows the label panel renders for the same keys. Only
    // styleSetters differ between the two paths; capabilities are made
    // identical so the gates answer identically.
    installLeafletGlobals();
    const caps = {
      fill: "native",
      stroke: "native",
      opacity: "pane",
      zoomRange: "pane",
      label: "none",
    };
    const rowSel = [
      ".foliplus-style-fill-row",
      ".foliplus-style-border-row",
      ".foliplus-style-opacity-track",
      ".foliplus-style-zoom-range-row",
    ];

    // Path A — label panel (no styleSetters): a vector layer whose
    // surface admits all four Layer dims.
    const leaf = pathify({
      options: {
        color: "#000000",
        weight: 2,
        fillColor: "#aabbcc",
        fillOpacity: 0.5,
      },
      setStyle: vi.fn(),
      on: vi.fn(),
    });
    manager.registerLayer({
      id: "sweepVector",
      name: "Vector",
      role: "overlay",
      layer: {
        options: {},
        eachLayer: vi.fn((fn: (child: unknown) => void) => fn(leaf)),
        getBounds: vi.fn(() => ({
          isValid: vi.fn(() => true),
          getSouthWest: () => ({ lat: 0, lng: 0 }),
          getNorthEast: () => ({ lat: 1, lng: 1 }),
        })),
      } as never,
    });
    ui.runtimeStore.setFields("sweepVector", [{ name: "count", numeric: true }]);
    const surfaceV = manager.surfaceFor(
      manager.layerRegistry.get("sweepVector")!,
    ) as unknown as { capabilities: Record<string, unknown> };
    surfaceV.capabilities = { ...caps };

    const itemV = findItem(ui, "sweepVector");
    ui.openStylePanel("sweepVector");
    const panelV = panelOf(itemV)!;
    const panelRows = rowSel.filter(sel => panelV.querySelector(sel));
    expect(panelRows).toEqual(rowSel);
    ui.closeStylePanel(false);

    // Path B — delegated drawer (styleSetters present): the same
    // capabilities, so the registry gates answer the same way. The sweep
    // must render exactly the non-vector-only rows.
    manager.registerLayer({
      id: "sweepDeleg",
      name: "Deleg",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const surfaceD = manager.surfaceFor(
      manager.layerRegistry.get("sweepDeleg")!,
    ) as unknown as { capabilities: Record<string, unknown> };
    surfaceD.capabilities = { ...caps };

    const itemD = findItem(ui, "sweepDeleg");
    ui.openStylePanel("sweepDeleg");
    const panelD = panelOf(itemD)!;
    const delegatedRows = rowSel.filter(sel => panelD.querySelector(sel));
    expect(delegatedRows).toEqual([
      ".foliplus-style-opacity-track",
      ".foliplus-style-zoom-range-row",
    ]);
  });

  // Row-rendering matrix for the two basemap faces — this matrix pins the
  // zoomRange cells. Both basemap kinds now render the zoomRange row: a real
  // GridLayer carries it through native min/maxZoom (the honest carrier), and the
  // solid-color basemap through the isColorBasemap fallback (its surface
  // reports zoomRange: "none", but the executor's visible op is still the
  // carrier, so the row is not a lie). fill/border cells are documented for
  // the reader — border needs caps = {opacity:pane, zoomRange:pane}, which
  // no basemap satisfies; fill needs the same for the vector path but is
  // re-routed through isColorBasemap for the color face.
  //
  //   Tile (base + GridLayer): fill ✗ / border ✗ / opacity ✓ (native) / zoomRange ✓ (native)
  //   Color (base + pane):     fill ✓  / border ✗ / opacity ✓ (pane)   / zoomRange ✓ (isColorBasemap)

  it("tile basemap (GridLayer) renders the zoomRange row: native min/maxZoom is the carrier", () => {
    // The old `li.role !== "base"` blanket was dropped: a TileLayer is a
    // GridLayer subclass whose options.minZoom/maxZoom are exactly the
    // carrier the row writes through, so refusing it was a false refusal.
    // GridLayer is required — a bare `{ options: {} } as never` also gets a
    // row, but through the content-panes fallback, which is not the carrier
    // this test is checking.
    manager.registerLayer({
      id: "tileBase1",
      name: "OSM",
      role: "base",
      layer: new GridLayer() as never,
    });
    ui.runtimeStore.setFields("tileBase1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "tileBase1");
    ui.openStylePanel("tileBase1");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
  });

  it("color basemap renders the zoomRange row through the isColorBasemap fallback", () => {
    // detectCapabilities reports zoomRange: "none" for the color face
    // (the always-on fallback color has no honest range carrier of its
    // own); isColorBasemap is the second clause that lets the row still
    // render, because the executor's visible op is the real carrier.
    // Without the flag the row would be a lie (writes a value that never
    // lands), which is what the flag guards against.
    manager.registerLayer({
      id: "colormap",
      name: "Color",
      role: "base",
      color: "#3366cc",
    });
    ui.runtimeStore.setFields("colormap", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "colormap");
    ui.openStylePanel("colormap");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).not.toBeNull();
  });

  it("declines a zoomRange row for a base layer whose surface carries no range", () => {
    // A fake base layer with `capabilities.zoomRange` forced to "none" —
    // the honest-degradation path that used to be papered over by the
    // blanket base-group guard. The panel still renders (opacity carrier is
    // intact), but the zoomRange row is omitted rather than written as a
    // lie that would persist and never apply.
    manager.registerLayer({
      id: "norange1",
      name: "N",
      role: "base",
      layer: pathify({ options: {} }) as never,
      // An owned pane name: a shared-pane declaration is refused now (the
      // layer gets its own synthesized pane instead of adopting tilePane).
      paneName: "norange-pane",
    });
    const li = manager.layerRegistry.get("norange1")!;
    manager.surfaceFor(li).capabilities.zoomRange = "none";
    ui.runtimeStore.setFields("norange1", [{ name: "count", numeric: true }]);

    const item = findItem(ui, "norange1");
    ui.openStylePanel("norange1");
    const panel = panelOf(item)!;
    expect(panel, "the style panel rendered").toBeTruthy();

    expect(panel!.querySelector(".foliplus-style-zoom-range-row")).toBeNull();
  });

  it("layerCanOpacity returns false when the layer is not in the registry", () => {
    // Covers the `!li` guard in layerCanOpacity: a layer with cached fields but
    // no registry entry cannot have its surface queried.
    ui.runtimeStore.setFields("overlay1", [{ name: "count", numeric: true }]);
    const li = manager.layerRegistry.get("overlay1");
    manager.layerRegistry.remove("overlay1");

    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    // Panel is rendered (fields are cached) but without the opacity row.
    if (panel) {
      expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
    }

    // Restore for cleanup
    if (li) manager.layerRegistry.upsert(li);
  });
});
