// test/js/control/LayerControl/ui/style/index.opacity — the opacity row and basemap hatch sync.
import { findItem, initFixture } from "../fixture.js";
import { fillPct, keepBubble, restoreBubble } from "./index.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureModes } from "#core/lifecycle/index.js";
import { SLIDER_CLASS, sliderOf } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";
import {
  getIntent,
  seedIntentMap,
  setIntent,
} from "#control/LayerControl/ui/intent.js";
import { resetLayerOpacity } from "#control/LayerControl/ui/style/opacity.js";

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
  it("renders the opacity slider defaulting to 100", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(host).not.toBeNull();
    // The primitive owns the class, mode and aria; the row only names its
    // host so a later pass can reach the instance through sliderOf().
    expect(host.classList.contains(SLIDER_CLASS.ROOT)).toBe(true);
    expect(host.dataset.mode).toBe("single");
    const thumb = host.querySelector(".foliplus-slider-thumb") as HTMLElement;
    expect(thumb.getAttribute("role")).toBe("slider");
    expect(thumb.getAttribute("aria-orientation")).toBe("horizontal");
    expect(thumb.getAttribute("aria-valuemin")).toBe("0");
    expect(thumb.getAttribute("aria-valuemax")).toBe("100");
    expect(thumb.getAttribute("aria-valuenow")).toBe("100");
    expect(sliderOf(host)!.value).toBe(100);
  });

  it("an opacity change applies to the layer and persists", () => {
    const li = manager.layerRegistry.get("overlay1")!;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;
    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;

    sliderOf(host)!.setValue(60);

    expect(li.opacity).toBe(0.6);
    expect(getIntent(ui, "overlay1", "opacity")).toBe(0.6);
  });

  it("commitOpacityPct re-syncs the no-basemap hatch for base layers", () => {
    // Dragging the only basemap to opacity=0 leaves it visually empty — the
    // hatch has to light up, which happens only if commitOpacityPct fires
    // syncNoBasemap. Overlay opacity is unrelated, so a base-vs-overlay
    // toggle must be observable.
    const toggleSpy = vi.fn();
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "base1");
      ui.openStylePanel("base1");
      console.log(
        "BASE1_DEBUG",
        JSON.stringify(
          manager.surfaceFor(manager.layerRegistry.get("base1")!).capabilities,
        ),
      );
      const host = panelOf(item)!.querySelector(
        `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
      ) as HTMLElement;
      sliderOf(host)!.setValue(0);
      const baseCalls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(baseCalls.length).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("commitOpacityPct skips the hatch sync for overlays", () => {
    const toggleSpy = vi.fn();
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const item = findItem(ui, "overlay1");
      ui.openStylePanel("overlay1");
      const host = panelOf(item)!.querySelector(
        `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
      ) as HTMLElement;
      sliderOf(host)!.setValue(0);
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("resetLayerOpacity re-syncs the hatch for base layers", () => {
    // Resetting a basemap that was at 0 back to 1 flips the hatch off.
    // Same invariant as commitOpacityPct: base → sync, overlay → skip.
    const toggleSpy = vi.fn();
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const li = manager.layerRegistry.get("base1")!;
      setIntent(ui, "base1", "opacity", 0);
      li.opacity = 0;
      resetLayerOpacity(ui, "base1");
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls.length).toBeGreaterThan(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("resetLayerOpacity skips the hatch sync for overlays", () => {
    const toggleSpy = vi.fn();
    vi.spyOn(ui.c.map, "getContainer").mockImplementation(
      () =>
        ({
          classList: { toggle: toggleSpy, remove: vi.fn() },
        }) as unknown as HTMLElement,
    );
    try {
      const li = manager.layerRegistry.get("overlay1")!;
      setIntent(ui, "overlay1", "opacity", 0);
      li.opacity = 0;
      resetLayerOpacity(ui, "overlay1");
      const calls = toggleSpy.mock.calls.filter(
        c => c[0] === CONST.CLASSES.NO_BASE_MAP,
      );
      expect(calls).toEqual([]);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("reopening the panel seeds the opacity slider from intents.opacity", () => {
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const host = panelOf(item)!.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    sliderOf(host)!.setValue(25);
    ui.closeStylePanel(false);

    ui.openStylePanel("overlay1");
    const reopened = panelOf(item)!;
    const reopenedHost = reopened.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(sliderOf(reopenedHost)!.value).toBe(25);
    expect(
      fillPct(reopened.querySelector(".foliplus-slider-fill") as HTMLElement),
    ).toBeCloseTo(0.25);
  });

  it("paints the row at 100% when nothing stored an opacity yet", () => {
    // Neither the persisted map nor the registry entry carries a value — the
    // fresh-open path must still paint a full slider rather than NaN/empty.
    const li = manager.layerRegistry.get("overlay1")!;
    delete (li as { opacity?: number }).opacity;
    const item = findItem(ui, "overlay1");
    ui.openStylePanel("overlay1");
    const panel = panelOf(item)!;

    const host = panel.querySelector(
      `.${CONST.CLASSES.STYLE_OPACITY_TRACK}`,
    ) as HTMLElement;
    expect(sliderOf(host)!.value).toBe(100);
  });

  it("omits the opacity row for a surface that cannot carry it (delegated)", () => {
    // MarkerCluster duck: `_topClusterLevel` triggers `opacity: "none"`.
    // The delegated label controls must still render — the panel is not
    // empty, only the opacity row is gone.
    manager.registerLayer({
      id: "cluster1",
      name: "Cluster",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
      styleProvider: () => ({ labelShow: true, labelSize: 14, labelColor: "#ff0000" }),
      styleSetters: { labelShow: vi.fn(), labelSize: vi.fn(), labelColor: vi.fn() },
    });
    const item = findItem(ui, "cluster1");
    ui.openStylePanel("cluster1");
    const panel = panelOf(item)!;

    // No opacity row at all.
    expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
    expect(panel.querySelector(".foliplus-style-opacity-number")).toBeNull();
    // The delegated label controls are still there.
    expect(panel.querySelector(".foliplus-style-label-size-input")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
  });

  it("omits the opacity row for a surface that cannot carry it (label)", () => {
    // Same duck, but the label panel (not delegated). The field/format/
    // collide rows must still render.
    manager.registerLayer({
      id: "cluster2",
      name: "Cluster2",
      layer: { options: {}, eachLayer: vi.fn(), _topClusterLevel: {} } as never,
    });
    ui.runtimeStore.setFields("cluster2", [{ name: "count", numeric: true }]);
    // The cluster's own probe finds no labelable leaves (empty eachLayer),
    // but this test pins the OPACITY carrier — the Label section stands in
    // for "a panel exists at all", so declare the label bit by hand.
    const clusterLi = manager.layerRegistry.get("cluster2")!;
    const clusterSurface = manager.surfaceFor(clusterLi) as unknown as {
      capabilities: Record<string, unknown>;
    };
    clusterSurface.capabilities = {
      ...clusterSurface.capabilities,
      label: "pane",
    };
    const item = findItem(ui, "cluster2");
    ui.openStylePanel("cluster2");
    const panel = panelOf(item)!;

    expect(panel.querySelector(".foliplus-style-opacity-track")).toBeNull();
    expect(panel.querySelector(".foliplus-style-opacity-number")).toBeNull();
    // Annotation rows are still there.
    expect(panel.querySelector(".foliplus-style-field-select")).not.toBeNull();
    expect(panel.querySelector(".foliplus-style-label-color-input")).not.toBeNull();
  });
});
