// test/js/control/LayerControl/ui/style/index.cache — style menu item, field cache and label state seeding.
import { attachedPanel, findItem, initFixture } from "../fixture.js";
import { keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { NUMBER_FORMAT } from "#platform/format.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import { seedIntentMap } from "#control/LayerControl/ui/intent.js";
import { layerHasLabelFields } from "#control/LayerControl/ui/style/index.js";

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
  // ─────────────────── ⋮ menu item ───────────────────

  it("the ⋮ menu's Style item is enabled for pane-capable layers even without labels", () => {
    // Capability-driven gate. A layer whose surface reports opacity/zoomRange
    // capability gets the panel enabled — the opacity and zoomRange sliders are
    // useful even without label fields.
    ui.runtimeStore.deleteFields("overlay1");
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("aria-disabled")).not.toBe("true");
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item is enabled once the layer has fields", () => {
    const item = findItem(ui, "overlay1");

    ui.openMoreMenu(item);

    const styleItem = item.querySelector(
      `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
    ) as HTMLElement;
    expect(styleItem.getAttribute("aria-disabled")).not.toBe("true");
    expect(styleItem.getAttribute("title")).toBe("LayerControl.style_layer_tooltip");
  });

  it("the ⋮ menu's Style item follows the checkbox on a basemap row too", () => {
    // Every row obeys one rule: Style is clickable only while the row is
    // checked. A basemap row is not exempt — consulted ahead of the basemap
    // "no extent" verdict, an off row is simply hidden and has nothing to
    // style. The color basemap starts unchecked, so its Style entry starts
    // disabled and turns on with the box.
    const item = attachedPanel(ui).querySelector(
      `[${CONST.DATA.LAYER_ID}="${CONST.SOLID_BASEMAP_ID}"]`,
    ) as HTMLElement;
    const box = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const styleItemOf = () =>
      item.querySelector(
        `.foliplus-layer-more-menu button[data-action="${CONST.ACTION.STYLE_LAYER}"]`,
      ) as HTMLElement;

    box.checked = false;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("aria-disabled")).toBe("true");

    box.checked = true;
    ui.openMoreMenu(item);
    expect(styleItemOf().getAttribute("aria-disabled")).not.toBe("true");
  });

  // ─────────────────── field cache ───────────────────

  it("caches collectFields per layer id", () => {
    ui.runtimeStore.deleteFields("overlay1");
    const collect = vi.spyOn(manager.label, "collectFields");

    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([]);
  });

  it("drops a stale cached empty field list on LAYER_ITEM_COUNT_CHANGE", () => {
    // A layer registered with no labelable fields caches an empty list; a
    // runtime createLayers may later add features carrying properties, which
    // must un-stick the ⋮ menu's Style item.
    ui.runtimeStore.deleteFields("overlay1");
    expect(layerHasLabelFields(ui, "overlay1")).toBe(false);
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([]);

    const fields = [
      { name: "count", numeric: true },
      { name: "name", numeric: false },
    ];
    vi.spyOn(manager.label, "collectFields").mockReturnValue(fields);

    ui.onLayerItemCountChange("overlay1");

    expect(ui.runtimeStore.getFields("overlay1")).toBeUndefined();
    expect(layerHasLabelFields(ui, "overlay1")).toBe(true);
  });

  it("re-renders a shown layer when its fields are invalidated", () => {
    // Dropping the cache is not enough: the drawn labels carry text baked from
    // the old fields while the picker would resolve a new default field, so the
    // map and the panel would disagree until the user touched a control.
    manager.label.setConfig("overlay1", {
      show: true,
      field: "count",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("does not re-render a layer whose labels are off", () => {
    manager.label.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.invalidateFields("overlay1");

    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("invalidateFields drops a layer's cached list", () => {
    layerHasLabelFields(ui, "overlay1");
    expect(ui.runtimeStore.getFields("overlay1")).toBeDefined();

    // The delegate is the surface `manager.unregisterLayer` drives.
    ui.invalidateFields("overlay1");
    expect(ui.runtimeStore.getFields("overlay1")).toBeUndefined();
  });

  it("keeps the field cache across close/reopen (count changes invalidate)", () => {
    // Closing the panel must not defeat the cache: re-collection on every
    // reopen walks every feature for nothing. The cache is dropped by
    // onLayerItemCountChange instead, when features actually change.
    const item = findItem(ui, "overlay1");

    ui.openStylePanel("overlay1");
    ui.closeStylePanel(true);

    expect(panelOf(item)).toBeUndefined();
    expect(ui.runtimeStore.getFields("overlay1")).toEqual([
      { name: "count", numeric: true },
    ]);
  });

  // ─────────────────── persisted state ───────────────────

  it("applyStyleLabelState seeds a stored config for a layer that has none", () => {
    seedIntentMap(ui, "label", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
    });
    const setConfig = vi.spyOn(manager.label, "setConfig");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith("overlay1", {
      show: true,
      field: "count",
      color: CONST.DEFAULT_LABEL.color,
      size: CONST.DEFAULT_LABEL.size,
      format: NUMBER_FORMAT.AUTO,
      collide: true,
    });
    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState falls back for non-typed stored color/size", () => {
    seedIntentMap(ui, "label", {
      overlay1: {
        show: true,
        field: "count",
        color: 42 as unknown as string,
        size: "big" as unknown as number,
        format: NUMBER_FORMAT.AUTO,
      } as any,
    });
    const setConfig = vi.spyOn(manager.label, "setConfig");

    ui.applyStyleLabelState();

    expect(setConfig).toHaveBeenCalledWith(
      "overlay1",
      expect.objectContaining({
        color: CONST.DEFAULT_LABEL.color,
        size: CONST.DEFAULT_LABEL.size,
      }),
    );
  });

  it("applyStyleLabelState normalizes a stored short hex color and clamps size", () => {
    seedIntentMap(ui, "label", {
      overlay1: {
        show: true,
        field: "count",
        color: "#abc",
        size: 99,
        format: NUMBER_FORMAT.AUTO,
      } as any,
    });
    const setConfig = vi.spyOn(manager.label, "setConfig");

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
    manager.label.setConfig("overlay1", {
      show: false,
      field: "",
      format: NUMBER_FORMAT.AUTO,
    } as any);
    seedIntentMap(ui, "label", {
      overlay1: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
    });
    const setConfig = vi.spyOn(manager.label, "setConfig");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
    expect(manager.label.getConfig("overlay1").show).toBe(false);
  });

  it("applyStyleLabelState renders a shown config that names no field", () => {
    // `field: ""` means "never picked", not "nothing to show" — a shown config
    // must still render (renderLabels resolves the layer's default pick).
    seedIntentMap(ui, "label", { overlay1: { show: true, field: "" } as any });
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips configs that are switched off", () => {
    seedIntentMap(ui, "label", {
      overlay1: { show: false, field: "count" } as any,
    });
    const renderLabels = vi.spyOn(manager.label, "renderLabels");
    const clearLabels = vi.spyOn(manager.label, "clearLabels");

    ui.applyStyleLabelState();

    expect(renderLabels).not.toHaveBeenCalled();
    // …and it clears instead: a stored `show: false` applied over labels left
    // on the map would leave the toggle reading off above visible labels.
    expect(clearLabels).toHaveBeenCalledWith("overlay1");
  });

  it("applyStyleLabelState skips stale ids whose layers are gone", () => {
    seedIntentMap(ui, "label", {
      ghost: { show: true, field: "count", format: NUMBER_FORMAT.AUTO } as any,
    });
    const setConfig = vi.spyOn(manager.label, "setConfig");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.applyStyleLabelState();

    // A stale id must not be written back into the live config map, or the
    // next annotations save would resurrect a removed layer.
    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("applyStyleLabelState skips an intent that carries no label", () => {
    // An id present in `ui.intentStore` for a different dimension (e.g. a rename)
    // must not be treated as a label seed.
    seedIntentMap(ui, "name", { overlay1: "Renamed" });
    const setConfig = vi.spyOn(manager.label, "setConfig");
    const renderLabels = vi.spyOn(manager.label, "renderLabels");

    ui.applyStyleLabelState();

    expect(setConfig).not.toHaveBeenCalled();
    expect(renderLabels).not.toHaveBeenCalled();
  });

  it("applyStyleLabelState is a no-op when the IntentStore is empty", () => {
    ui.intentStore.clearAll();
    expect(() => ui.applyStyleLabelState()).not.toThrow();
  });
});
