// test/js/control/LayerControl/ui/style/index.reset — the reset footer and declared styles.
import { findItem, initFixture } from "../fixture.js";
import { keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { type ComponentConfig } from "#foliplus/config-schema.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import { sliderOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import {
  layerHasLabelFields,
  refreshStylePanel,
} from "#control/LayerControl/ui/style/index.js";

describe("LayerUI style panel", () => {
  let manager: LayerController;

  let ui: LayerUI;

  let map: any;

  // The declaration channel is CONFIG.data, read when the LabelManager is
  // constructed, so a test that declares a label rebuilds the fixture with the
  // rendered rows instead of mutating the layer after the fact.
  const setup = (
    configData?: NonNullable<Parameters<typeof initFixture>[0]>["configData"],
  ) => {
    restoreBubble();
    ({ manager, ui, map } = initFixture({ configData }));
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
  };

  /** One rendered row carrying a normalised label fact — the shape Python
   *  emits into CONFIG.data. */
  const declaredRow = (
    label: NonNullable<ComponentConfig["data"]>[number]["label"],
  ): NonNullable<Parameters<typeof initFixture>[0]>["configData"] => [
    { id: "overlay1", name: "Polygons", role: "overlay", show: true, label },
  ];

  beforeEach(() => {
    setup();
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
  it("Reset is disabled while the layer is on its declared style", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;

    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(btn.title).toBe("LayerControl.style_reset_disabled");
  });

  it("a style write enables Reset live, and Reset disables it again", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    // A label write is the one path that does not publish LAYER_STYLE_CHANGE:
    // the panel refreshes the footer itself.
    const toggle = panel.querySelector(
      ".foliplus-style-toggle-input",
    ) as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
    expect(btn.title).toBe("LayerControl.style_reset_tooltip");

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const next = panelOf(item)!;
    const nextBtn = next.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    // The disabled trigger cannot take focus; the panel keeps it.
    expect(next.contains(document.activeElement)).toBe(true);
  });

  it("an external style change re-reads the footer's state", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    ui.intentStore.set("overlay1", "opacity", 0.4);
    (manager.events as unknown as { emit: (e: string, p: unknown) => void }).emit(
      "foliplus:layer:style-change",
      { id: "overlay1" },
    );

    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("aria-disabled")).toBe("false");
  });

  it("an opacity drag enables Reset", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(30);

    expect(btn.disabled).toBe(false);
  });

  it("a zoom-range commit enables Reset", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);

    const row = panel.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_ROW}`,
    ) as HTMLElement;
    const host = row.querySelector(
      `.${CONST.CLASSES.STYLE_ZOOM_RANGE_CONTROL}`,
    ) as HTMLElement;
    const slider = sliderOf(host)!;
    slider.setValue([4, map.getMaxZoom()]);
    slider.commit();

    expect(btn.disabled).toBe(false);
  });

  it("reports a throwing reset dimension and still refreshes", () => {
    const item = findItem(ui, "overlay1");
    manager.label.setConfig("overlay1", { show: true, field: "count" } as any);
    ui.openStylePanel("overlay1");
    const warn = vi.spyOn(ui.log, "warn").mockImplementation(() => {});
    vi.spyOn(ui.c.label, "clearConfig").mockImplementationOnce(() => {
      throw new Error("boom");
    });

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The failing label step is reported, and the refresh half still ran.
    expect(warn).toHaveBeenCalled();
    expect(panelOf(item)).toBeDefined();
    warn.mockRestore();
  });

  it("reset restores the default config and keeps the panel open", () => {
    const item = findItem(ui, "overlay1");
    const focusSpy = vi.fn();
    item.focus = focusSpy;
    ui.openStylePanel("overlay1");
    manager.label.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.INT,
    } as any);

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    // Shared panel-btn recipe + never-submit type (the builder contract, so
    // reset and clear stay on one CSS class).
    expect(btn.classList.contains("foliplus-panel-btn")).toBe(true);
    expect(btn.type).toBe("button");
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The default config, plus the page's collide default injected by getConfig.
    expect(manager.label.getConfig("overlay1")).toEqual({
      ...CONST.DEFAULT_LABEL,
      collide: true,
    });
    expect(panelOf(item)).toBeDefined();
    expect(focusSpy).not.toHaveBeenCalled();
    // Reset has nothing left to restore, so the rebuilt button is disabled and
    // cannot take focus: focus falls to the panel's first usable control (the
    // header close button) rather than to a dead target.
    const nextBtn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(nextBtn.disabled).toBe(true);
    expect(panelOf(item)!.contains(document.activeElement)).toBe(true);
  });

  it("reset preserves the panel's scroll position", () => {
    const item = findItem(ui, "overlay1");
    // A pristine layer disables Reset; the scroll contract needs a live one.
    manager.label.setConfig("overlay1", { show: true, field: "count" } as any);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const content = panel.querySelector(".foliplus-panel-content") as HTMLElement;
    content.scrollTop = 37;

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const next = panelOf(item)!;
    expect(next).not.toBe(panel);
    expect(
      (next.querySelector(".foliplus-panel-content") as HTMLElement).scrollTop,
    ).toBe(37);
  });

  it("closes the panel when the refresh cannot render", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");

    refreshStylePanel(ui, "overlay1", () => null);

    expect(panelOf(item)).toBeUndefined();
  });

  it("reset keeps the panel when the refresh has no panel handle", () => {
    const item = findItem(ui, "overlay1");
    manager.label.setConfig("overlay1", { show: true, field: "count" } as any);
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    ui.overlayPanel.stylePanelEl = null;

    const btn = panel.querySelector(".foliplus-style-reset-btn") as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(panelOf(item)).toBe(panel);
    expect(panel.isConnected).toBe(true);
  });

  it("reset keeps the panel open without bubbling to the map", () => {
    // A press on the Reset button must not also become a map click: the
    // refresh removes the old panel mid-dispatch, so the click would otherwise
    // keep walking its original path with no live control ancestor and land on
    // the map (the same guarantee as the ⋮ menu — #807).
    const item = findItem(ui, "overlay1");
    manager.label.setConfig("overlay1", { show: true, field: "count" } as any);
    ui.openStylePanel("overlay1");
    const bubbled = vi.fn();
    item.addEventListener("click", bubbled);

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    // The panel stays open…
    expect(panelOf(item)).toBeDefined();
    // …and the press was swallowed, never reaching the row / map.
    expect(bubbled).not.toHaveBeenCalled();
  });

  it("reset also restores collide (not just show/field/format)", () => {
    // Regression: DEFAULT_LABEL alone omits collide, so a user-toggled
    // avoid-overlap switch used to survive Reset. defaultConfig() carries it.
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    manager.label.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    } as any);

    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(manager.label.getConfig("overlay1").collide).toBe(true);
  });

  it("reset drops the entry, so the author's declaration shows through", () => {
    // A declaration is normalised by Python into CONFIG.data (folium's
    // `explore(foliplus=...)`); it is not layer state. Writing the defaults
    // back on Reset would shadow the author's field, and persisting that
    // shadow would keep it for good.
    setup(declaredRow({ field: "declared", show: true }));
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    manager.label.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
      collide: false,
    } as any);
    expect(manager.label.getConfig("overlay1").field).toBe("count");

    // Arm the timers before the click: the save is debounced, and the timer
    // must be created against the fake clock to be advanceable.
    vi.useFakeTimers();
    const btn = panelOf(item)!.querySelector(
      ".foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    vi.advanceTimersByTime(CONST.SAVE_DEBOUNCE_MS + 50);

    expect(manager.label.hasConfig("overlay1")).toBe(false);
    expect(manager.label.getConfig("overlay1").field).toBe("declared");
    // The declaration implies show, so the labels are back on — Reset returns the
    // layer to the author's default, not to "labels off".
    expect(manager.label.getConfig("overlay1").show).toBe(true);
    // No stored choice means collide comes from the page-level default again.
    expect(manager.label.getConfig("overlay1").collide).toBe(true);
    // configEntries is the record's only source for the label key, so an
    // empty result is what keeps a reload from re-seeding the shadow.
    expect(manager.label.configEntries()).toHaveLength(0);
    const rec = JSON.parse(window.localStorage.getItem(CONST.STORAGE.KEY)!).data;
    expect(rec.layers.overlay1?.label).toBeUndefined();
  });

  it("renders the labels a layer declares, with no panel interaction", () => {
    // The load-time half of the declaration: getConfig's `show` alone draws
    // nothing, because the canvas is only built by renderLabels. This sweep is
    // what puts a declared field on the map at all.
    setup(declaredRow({ field: "count", show: true }));

    const render = vi.spyOn(manager.label, "renderLabels").mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).toHaveBeenCalledWith("overlay1");
  });

  it("leaves labels off when the declaration says show: false", () => {
    setup(declaredRow({ field: "count", show: false }));

    const render = vi.spyOn(manager.label, "renderLabels").mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer the user has configured for themselves", () => {
    // The live config wins over the declaration, so the sweep must not redraw a
    // layer the user has already tuned.
    setup(declaredRow({ field: "count", show: true }));
    manager.label.setConfig("overlay1", {
      show: true,
      field: "name",
      format: NUMBER_FORMAT.AUTO,
    } as any);

    const render = vi.spyOn(manager.label, "renderLabels").mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalled();
  });

  it("does not render a declaration the layer has no labelable fields for", () => {
    // A declaration is an author's promise about the panel's starting point, not a
    // reason to paint. Building a canvas over an empty field list would leave a
    // blank layer with the toggle reading on.
    setup(declaredRow({ field: "count", show: true }));
    ui.runtimeStore.deleteFields("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);

    const render = vi.spyOn(manager.label, "renderLabels").mockImplementation(() => []);
    ui.applyStyleLabelState();

    expect(render).not.toHaveBeenCalledWith("overlay1");
  });
});
