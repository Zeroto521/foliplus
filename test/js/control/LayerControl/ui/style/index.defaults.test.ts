// test/js/control/LayerControl/ui/style/index.defaults — delegated reset against component defaults.
import { findItem, initFixture } from "../fixture.js";
import { keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
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

  // ─────────────────── delegated reset (Python CONFIG defaults) ───────────────────

  it("delegated panel hides Reset when the layer supplies no styleDefaultsProvider", () => {
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

  it("delegated panel renders Reset when styleDefaultsProvider is present", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: false }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("LayerControl.style_reset");
  });

  it("delegated Reset is disabled when the component style equals its defaults", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("delegated Reset enables when the component style moved off its defaults", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: false }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("delegated Reset compares nested style values structurally", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, zoom: [1, 9], opts: { a: 1 } }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true, zoom: [1, 9], opts: { a: 1 } }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("delegated Reset treats a changed nested value as moved", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, opts: { a: 2 } }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true, opts: { a: 1 } }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("delegated Reset treats an extra nested key as moved", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, opts: { a: 1, b: 2 } }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true, opts: { a: 1 } }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("delegated Reset reads a missing provider as pristine", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("delegated Reset tolerates a provider that returns nothing", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: (() => undefined) as unknown as () => Record<string, unknown>,
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true }),
    });
    const item = findItem(ui, "heat1");

    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it("a vanished layer reads as pristine on the next style signal", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    vi.spyOn(manager.layerRegistry, "get").mockReturnValue(undefined);
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "overlay1" },
    );

    expect(btn.disabled).toBe(true);
  });

  it("delegated Reset treats an array of another length or type as moved", () => {
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, zoom: [1, 9] }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({ labelShow: true, zoom: [1] }),
    });
    const short = findItem(ui, "heat1");
    ui.openStylePanel("heat1");
    expect(
      panelOf(short)!
        .querySelector(".foliplus-style-reset-btn")!
        .hasAttribute("disabled"),
    ).toBe(false);
    closeStylePanel(ui, false);

    manager.registerLayer({
      id: "heat2",
      name: "Heat 2",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, zoom: [1, 9] }),
      styleSetters: { labelShow: vi.fn() },
      styleDefaultsProvider: () => ({
        labelShow: true,
        zoom: 1 as unknown as number[],
      }),
    });
    const scalar = findItem(ui, "heat2");
    ui.openStylePanel("heat2");
    expect(
      panelOf(scalar)!
        .querySelector(".foliplus-style-reset-btn")!
        .hasAttribute("disabled"),
    ).toBe(false);
  });

  it("delegated Reset calls each setter and keeps the panel open", () => {
    const labelShowSetter = vi.fn();
    const labelCollideSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true, labelCollide: false }),
      styleSetters: { labelShow: labelShowSetter, labelCollide: labelCollideSetter },
      styleDefaultsProvider: () => ({ labelShow: false, labelCollide: true }),
    });
    const item = findItem(ui, "heat1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // Python CONFIG defaults — never the live / persisted values.
    expect(labelShowSetter).toHaveBeenCalledWith(false);
    expect(labelCollideSetter).toHaveBeenCalledWith(true);
    expect(panelOf(item)).toBeDefined();
    expect(focusSpy).not.toHaveBeenCalled();
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
      styleDefaultsProvider: () => ({ labelShow: false }),
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

  it("delegated Reset closes cleanly when styleDefaultsProvider returns undefined", () => {
    const labelShowSetter = vi.fn();
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: labelShowSetter },
      styleDefaultsProvider: () => undefined as unknown as Record<string, unknown>,
    });
    const item = findItem(ui, "heat1");
    ui.openStylePanel("heat1");

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // No default keys → no setter call, but the panel stays open.
    expect(labelShowSetter).not.toHaveBeenCalled();
    expect(panelOf(item)).toBeDefined();
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
      styleProvider: (() => provide()) as any,
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
      styleDefaultsProvider: () => ({ labelShow: false }),
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
    expect(panelOf(item)).toBeDefined();
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
