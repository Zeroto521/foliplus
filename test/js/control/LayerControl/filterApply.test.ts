import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilterFeatures } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { initFixture } from "./ui/fixture.js";

/** A geometry leaf stub with a real element the class toggle writes, exposed
 *  through the public getElement() the apply pass enumerates. */
const leafWithElement = (): L.Layer => {
  const el = document.createElement("path");
  return { getElement: () => el } as unknown as L.Layer;
};

/** A hand-built snapshot: 3 geometry leaves with a numeric `value` field.
 *  Filtering `value` to [2, 5] hides the first leaf (1) and keeps the last
 *  two (2, 5). */
const makeFeatures = (): LayerFilterFeatures => ({
  features: [
    { leaf: leafWithElement(), fields: { value: 1 } },
    { leaf: leafWithElement(), fields: { value: 2 } },
    { leaf: leafWithElement(), fields: { value: 5 } },
  ],
  total: 3,
  numericFields: ["value"],
  ranges: { value: [1, 5] },
  enumFields: [],
  enumValues: {},
});

const between = (field: string, range: readonly [number, number]) => ({
  kind: "atom" as const,
  field,
  op: "between" as const,
  range,
});

describe("generic data-layer filter (controller wiring)", () => {
  let manager: LayerController;
  let ui: LayerUI;

  it("uses the design contract class name foliplus-feature-filtered", () => {
    // The apply mechanism's DOM class is part of the design contract. Assert
    // the literal so a wrong const cannot silently pass alongside a wrong
    // class: renaming the class must change this test too.
    expect(CONST.CLASSES.FILTER_HIDDEN).toBe("foliplus-feature-filtered");
  });

  beforeEach(() => {
    const fixture = initFixture();
    manager = fixture.manager;
    ui = fixture.ui;
  });

  describe("registerLayer injection", () => {
    it("injects filterProvider/filterSetter for an ordinary overlay", () => {
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      const info = manager.layerRegistry.get("flt1");
      expect(info?.filterProvider).toBeTypeOf("function");
      expect(info?.filterSetter).toBeTypeOf("function");
    });

    it("does not inject for a base layer", () => {
      const tile = new (window.L.TileLayer as any)();
      manager.registerLayer({
        id: "base2",
        name: "Base",
        role: "base",
        layer: tile,
        paneName: "tilePane",
      });
      const info = manager.layerRegistry.get("base2");
      expect(info?.filterProvider).toBeNull();
      expect(info?.filterSetter).toBeNull();
    });

    it("does not override a caller-declared filterProvider", () => {
      const provider = vi.fn(() => null);
      manager.registerLayer({
        id: "explicit",
        name: "Explicit",
        role: "overlay",
        filterProvider: provider,
      });
      const info = manager.layerRegistry.get("explicit");
      expect(info?.filterProvider).toBe(provider);
    });

    it("filterSetter writes through to setLayerFilter", () => {
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      const info = manager.layerRegistry.get("flt1");
      const filter = between("value", [2, 5]);
      // Calling the injected setter runs the write-through closure and, with
      // no feature snapshot yet, the empty-features branch of applyFilterClass.
      info?.filterSetter?.(filter);
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(filter);
      // With no feature snapshot the empty-features branch installs an empty
      // hidden set; a WeakSet has no .size here, so assert by identity.
      expect(manager.hiddenSets.get("flt1")).toBeInstanceOf(WeakSet);
    });
  });

  describe("setLayerFilter", () => {
    it("applies FILTER_HIDDEN to non-matching leaves and publishes the change", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      const listener = vi.fn();
      manager.events.on(EVENTS.LAYER_FILTER_CHANGE, listener, "internal");

      manager.setLayerFilter("flt1", between("value", [2, 5]));

      const [a, b, c] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      expect(path(b.leaf)).toBe(false);
      expect(path(c.leaf)).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("removes the class from a leaf that stops matching (re-filter)", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      const [a] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      // Widen the range so the once-hidden leaf now matches again: the
      // re-apply must remove the class (a hidden-only add would leave it
      // hidden forever).
      manager.setLayerFilter("flt1", between("value", [1, 5]));
      for (const feature of features.features) {
        expect(path(feature.leaf)).toBe(false);
      }
    });

    it("clears the class for every leaf when the filter is removed", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      manager.setLayerFilter("flt1", undefined);
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      for (const feature of features.features) {
        expect(path(feature.leaf)).toBe(false);
      }
    });

    it("mirrors the committed filter into the layer entry slot (layers[id].filter)", () => {
      const features = makeFeatures();
      manager.registerLayer({ id: "flt1", name: "Flt", role: "overlay" });
      ui.runtimeStore.setFilterFeatures("flt1", features);
      // No filter yet: the slot starts empty.
      expect(manager.layerRegistry.get("flt1")?.filter).toBeUndefined();
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(
        between("value", [2, 5]),
      );
      manager.setLayerFilter("flt1", undefined);
      expect(manager.layerRegistry.get("flt1")?.filter).toBeUndefined();
    });

    it("replayFilter is a no-op for a layer with no committed filter", () => {
      // The layeradd late-binding replay must skip a layer that was never
      // filtered — the early return must not touch the hidden set.
      (manager as unknown as { replayFilter(id: string): void }).replayFilter("flt1");
      expect(manager.hiddenSets.get("flt1")).toBeUndefined();
    });

    it("replayFilter re-applies the committed filter (late-binding layeradd)", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      const [a] = features.features;
      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(a.leaf)).toBe(true);
      // A layeradd that arrives after the filter is committed replays it.
      (manager as unknown as { replayFilter(id: string): void }).replayFilter("flt1");
      expect(path(a.leaf)).toBe(true);
    });

    it("deleteFilterFeatures drops the snapshot and prunes the row", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBe(features);
      ui.runtimeStore.deleteFilterFeatures("flt1");
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBeUndefined();
    });
  });

  describe("genericFilterModel", () => {
    it("builds the range dimension + kept/total readout from the snapshot", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      const filter = between("value", [2, 5]);
      manager.setLayerFilter("flt1", filter);

      const model = manager.genericFilterModel("flt1");
      expect(model).not.toBeNull();
      expect(model?.dimensions[0]).toMatchObject({
        kind: "range",
        field: "value",
        range: [1, 5],
      });
      expect(model?.total).toBe(3);
      expect(model?.kept).toBe(2);
      expect(model?.filter).toEqual(filter);
    });

    it("returns null when the layer has no filterable numeric field", () => {
      ui.runtimeStore.setFilterFeatures("flt1", {
        features: [],
        total: 0,
        numericFields: [],
        ranges: {},
        enumFields: [],
        enumValues: {},
      });
      expect(manager.genericFilterModel("flt1")).toBeNull();
    });
  });
});
