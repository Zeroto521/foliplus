// test/js/control/LayerControl/controller.overlay — cross-panel contract with open overlays.
import { findItem, initFixture } from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilterModel } from "#core/layer/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import { type LayerUI } from "#control/LayerControl/ui/index.js";

describe("cross-panel contract: external actions × open overlays", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture({}));
  });

  it("LAYER_REMOVED closes an open filter panel anchored to the deleted layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openFilterPanel(item);
    expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("LAYER_REMOVED closes an open style panel anchored to the deleted layer", () => {
    ui.openStylePanel("overlay1");
    expect(ui.overlayPanel.stylePanelEl).not.toBeNull();
    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(ui.overlayPanel.stylePanelEl).toBeNull();
  });

  it("LAYER_REMOVED closes an open attrs panel anchored to the deleted layer", () => {
    const item = findItem(ui, "overlay1");
    ui.openAttrsPanel(item);
    expect(ui.overlayPanel.activeAttrsPanel).not.toBeNull();
    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
  });

  it("LAYER_REMOVED cancels an open rename anchored to the deleted layer", () => {
    ui.renameLayer("overlay1");
    expect(ui.overlayPanel.activeRenameId).toBe("overlay1");
    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(ui.overlayPanel.activeRenameId).toBeNull();
  });

  it("LAYER_REMOVED closes an open menu anchored to the deleted layer", () => {
    // The ⋮ menu is the only surface that used to have NO teardown watch: an
    // external delete while the menu is open left activeMenu / menuReposition /
    // menuOverlayUnregister hanging until the next open self-healed.
    const item = findItem(ui, "overlay1");
    ui.openMoreMenu(item);
    expect(ui.overlayPanel.activeMenu).not.toBeNull();
    expect(ui.overlayPanel.menuReposition).not.toBeNull();
    expect(manager.deleteLayer("overlay1")).toBe(true);
    expect(ui.overlayPanel.activeMenu).toBeNull();
    expect(ui.overlayPanel.menuReposition).toBeNull();
    expect(ui.overlayPanel.menuOverlayUnregister).toBeNull();
    expect(ui.overlayPanel.menuRemovedUnsub).toBeNull();
  });

  // A component-owned layer (Measure / Heatmap) clears via LAYER_DELETED instead
  // of unregistering — the id stays registerable for the next draw. The panel
  // must close on that channel too, not only on LAYER_REMOVED.
  const registerComponentLayer = () => {
    manager.registerLayer({
      id: "comp1",
      name: "Component",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    } as any);
  };

  it("LAYER_DELETED closes an open style panel anchored to a component-owned layer", () => {
    registerComponentLayer();
    ui.openStylePanel("comp1");
    expect(ui.overlayPanel.stylePanelEl).not.toBeNull();
    expect(manager.deleteLayer("comp1")).toBe(true);
    expect(ui.overlayPanel.stylePanelEl).toBeNull();
  });

  it("LAYER_DELETED closes an open attrs panel anchored to a component-owned layer", () => {
    registerComponentLayer();
    const item = findItem(ui, "comp1");
    ui.openAttrsPanel(item);
    expect(ui.overlayPanel.activeAttrsPanel).not.toBeNull();
    expect(manager.deleteLayer("comp1")).toBe(true);
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();
  });

  it("LAYER_DELETED cancels an open rename anchored to a component-owned layer", () => {
    registerComponentLayer();
    ui.renameLayer("comp1");
    expect(ui.overlayPanel.activeRenameId).toBe("comp1");
    expect(manager.deleteLayer("comp1")).toBe(true);
    expect(ui.overlayPanel.activeRenameId).toBeNull();
  });

  it("LAYER_DELETED closes an open menu anchored to a component-owned layer", () => {
    registerComponentLayer();
    const item = findItem(ui, "comp1");
    ui.openMoreMenu(item);
    expect(ui.overlayPanel.activeMenu).not.toBeNull();
    expect(manager.deleteLayer("comp1")).toBe(true);
    expect(ui.overlayPanel.activeMenu).toBeNull();
  });

  it("LAYER_DELETED closes an open filter panel anchored to a component-owned layer", () => {
    manager.registerLayer({
      id: "compFilter",
      name: "FilterComponent",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
      canvas: document.createElement("canvas"),
      filterProvider: vi.fn(() => ({
        dimensions: [{ kind: "range", field: "v", range: [0, 10], step: 1 }],
        filter: undefined,
        kept: 5,
        total: 10,
      })),
      filterSetter: vi.fn(),
      styleSetters: { labelShow: vi.fn() },
    } as any);
    const item = findItem(ui, "compFilter");
    ui.openFilterPanel(item);
    expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
    expect(manager.deleteLayer("compFilter")).toBe(true);
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();
  });

  it("OVERLAY_CLEAR closes every open overlay", () => {
    // Overlay types are mutually exclusive (each open tears the others down),
    // so one event must close whichever type is open. Each type is opened and
    // cleared in turn: commenting any lifecycle.ts:427-432 subscription fails
    // its own step.
    const item = findItem(ui, "overlay1");

    ui.openFilterPanel(item);
    expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.overlayPanel.activeFilterPanel).toBeNull();

    ui.openStylePanel("overlay1");
    expect(ui.overlayPanel.stylePanelEl).not.toBeNull();
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.overlayPanel.stylePanelEl).toBeNull();

    ui.openAttrsPanel(item);
    expect(ui.overlayPanel.activeAttrsPanel).not.toBeNull();
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.overlayPanel.activeAttrsPanel).toBeNull();

    ui.renameLayer("overlay1");
    expect(ui.overlayPanel.activeRenameId).toBe("overlay1");
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.overlayPanel.activeRenameId).toBeNull();

    // Menu: lifecycle.ts subscribes OVERLAY_CLEAR to closeMoreMenu. Commenting
    // that subscription leaves activeMenu + its detach pipe hanging.
    ui.openMoreMenu(item);
    expect(ui.overlayPanel.activeMenu).not.toBeNull();
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.overlayPanel.activeMenu).toBeNull();

    // Focus: lifecycle.ts subscribes OVERLAY_CLEAR to dismissFocus. Commenting
    // it leaves the focus rect + row highlight + mode lock in place.
    ui.focusLayer("overlay1");
    expect(ui.isFocusing()).toBe(true);
    ui.events.publish(EVENTS.OVERLAY_CLEAR);
    expect(ui.isFocusing()).toBe(false);
  });

  it("style panel stays open and refreshes on LAYER_STYLE_CHANGE", () => {
    // A delegated-style layer (styleSetters) renders through the delegated
    // path, which sets styleRefresh; the plain label path has no such hook.
    manager.registerLayer({
      id: "heat1",
      name: "Heat",
      canvas: document.createElement("canvas"),
      styleProvider: () => ({ labelShow: true }),
      styleSetters: { labelShow: vi.fn() },
    });
    ui.openStylePanel("heat1");
    expect(ui.overlayPanel.stylePanelEl).not.toBeNull();
    // styleRefresh is a (() => void) | null field, not a method, so
    // vi.spyOn rejects it (TS2769). Substitute the field with a mock, assert
    // the delegated path calls it, then restore the original hook.
    const refresh = vi.fn();
    const previousRefresh = ui.overlayPanel.styleRefresh;
    ui.overlayPanel.styleRefresh = refresh;
    try {
      ui.events.publish(EVENTS.LAYER_STYLE_CHANGE, { id: "heat1" });
      expect(ui.overlayPanel.stylePanelEl).not.toBeNull();
      expect(refresh).toHaveBeenCalled();
    } finally {
      ui.overlayPanel.styleRefresh = previousRefresh;
    }
  });

  it("filter panel stays open and refreshes on LAYER_FILTER_CHANGE", () => {
    // A filter-capable layer (filterProvider/filterSetter) sets up the
    // LAYER_FILTER_CHANGE subscription; the plain default overlay1 has no
    // such capability, so this must use a capable row. The panel refresh is
    // observed through its activeField (reconcile re-reads the model); the
    // row re-render also reads filterProvider, so a call-count spy would be
    // polluted.
    let modelField = "magnitude";
    const filterProvider = vi.fn((): LayerFilterModel => ({
      dimensions: [{ kind: "range", field: modelField, range: [0, 10], step: 1 }],
      filter: undefined,
      kept: 5,
      total: 10,
    }));
    manager.registerLayer({
      id: "f1",
      name: "Filterable",
      role: "overlay",
      layer: { options: {}, eachLayer: vi.fn() },
      filterProvider,
      filterSetter: vi.fn(),
    });
    const item = findItem(ui, "f1");
    ui.openFilterPanel(item);
    expect(ui.overlayPanel.activeFilterPanel?.activeField).toBe("magnitude");
    modelField = "depth";
    ui.events.publish(EVENTS.LAYER_FILTER_CHANGE, { id: "f1" });
    expect(ui.overlayPanel.activeFilterPanel).not.toBeNull();
    expect(ui.overlayPanel.activeFilterPanel?.activeField).toBe("depth");
  });
});
