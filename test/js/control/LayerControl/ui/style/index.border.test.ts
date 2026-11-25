// test/js/control/LayerControl/ui/style/index.border — the delegated border section.
import { findItem, initFixture } from "../fixture.js";
import { keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import {
  buildDelegatedBorderRow,
  renderDelegatedStylePanel,
} from "#control/LayerControl/ui/style/delegated.js";

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
  it("delegated panel renders a border section with color and weight inputs when both setters exist", () => {
    const borderColorSetter = vi.fn();
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        labelShow: true,
        labelFormat: "auto",
        borderWeight: 2,
        borderColor: "#ff0000",
      }),
      styleSetters: {
        labelShow: vi.fn(),
        labelFormat: vi.fn(),
        borderWeight: borderWeightSetter,
        borderColor: borderColorSetter,
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const panel = panelOf(item)!;
    const colorInput = panel.querySelector("input[type=color]") as HTMLInputElement;
    const weightInput = panel.querySelector("input[type=number]") as HTMLInputElement;
    expect(colorInput).not.toBeNull();
    expect(colorInput.value).toBe("#ff0000");
    expect(weightInput).not.toBeNull();
    expect(weightInput.value).toBe("2");
    expect(weightInput.min).toBe("0");
    expect(weightInput.max).toBe("10");
    expect(weightInput.step).toBe("0.5");
  });

  it("delegated border color input dispatches to styleSetters.borderColor on input", () => {
    const borderColorSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderColor: "#000000" }),
      styleSetters: { borderColor: borderColorSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    colorInput.value = "#abcdef";
    colorInput.dispatchEvent(new Event("input", { bubbles: true }));

    expect(borderColorSetter).toHaveBeenCalledWith("#abcdef");
  });

  it("delegated border weight input commits to styleSetters.borderWeight on change", () => {
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderWeight: 1 }),
      styleSetters: { borderWeight: borderWeightSetter },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    weightInput.value = "3";
    weightInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(borderWeightSetter).toHaveBeenCalledWith(3);
  });

  it("delegated panel returns null when a layer publishes only data setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(renderDelegatedStylePanel(ui, "dataOnly")).toBeNull();
  });

  it("buildDelegatedBorderRow returns null when the layer has no border setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(buildDelegatedBorderRow(ui, "dataOnly")).toBeNull();
  });

  it("delegated Reset restores borderWeight and borderColor from styleDefaultsProvider", () => {
    const borderColorSetter = vi.fn();
    const borderWeightSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderWeight: 3, borderColor: "#000000" }),
      styleSetters: {
        borderWeight: borderWeightSetter,
        borderColor: borderColorSetter,
      },
      styleDefaultsProvider: () => ({
        borderWeight: 1,
        borderColor: "#333333",
      }),
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const resetBtn = panelOf(item)!.querySelector(
      "button.foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(resetBtn).not.toBeNull();
    resetBtn.click();

    expect(borderWeightSetter).toHaveBeenCalledWith(1);
    expect(borderColorSetter).toHaveBeenCalledWith("#333333");
  });

  it("LAYER_STYLE_CHANGE refreshes border color and weight inputs from styleProvider", () => {
    let currentBorderColor = "#ff0000";
    let currentBorderWeight = 2;
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        borderColor: currentBorderColor,
        borderWeight: currentBorderWeight,
      }),
      styleSetters: {
        borderColor: vi.fn(),
        borderWeight: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    expect(colorInput.value).toBe("#ff0000");
    expect(weightInput.value).toBe("2");

    currentBorderColor = "#00ff00";
    currentBorderWeight = 4;
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe("#00ff00");
    expect(weightInput.value).toBe("4");
  });

  it("LAYER_STYLE_CHANGE skips border overwrite when the user is editing the input", () => {
    let currentBorderColor = "#ff0000";
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ borderColor: currentBorderColor }),
      styleSetters: { borderColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    colorInput.focus();

    currentBorderColor = "#0000ff";
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe("#ff0000");
  });

  it("LAYER_STYLE_CHANGE skips non-string borderColor and non-number borderWeight on refresh", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({
        borderColor: 42 as unknown as string,
        borderWeight: "3" as unknown as number,
      }),
      styleSetters: {
        borderColor: vi.fn(),
        borderWeight: vi.fn(),
      },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const weightInput = panelOf(item)!.querySelector(
      "input[type=number]",
    ) as HTMLInputElement;
    const originalColor = colorInput.value;
    const originalWeight = weightInput.value;

    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe(originalColor);
    expect(weightInput.value).toBe(originalWeight);
  });

  it("LAYER_STYLE_CHANGE bails when styleProvider returns undefined for a border layer", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => undefined as unknown as { borderColor?: string },
      styleSetters: { borderColor: vi.fn() },
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const colorInput = panelOf(item)!.querySelector(
      "input[type=color]",
    ) as HTMLInputElement;
    const originalColor = colorInput.value;

    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "heat1" },
    );

    expect(colorInput.value).toBe(originalColor);
  });

  it("delegated panel returns null when a layer publishes only data setters", () => {
    manager.registerLayer({
      id: "dataOnly",
      name: "DataOnly",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({}),
      styleSetters: { field: vi.fn() },
    });
    expect(renderDelegatedStylePanel(ui, "dataOnly")).toBeNull();
  });
});
