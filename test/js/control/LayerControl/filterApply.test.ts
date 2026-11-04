import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilterFeatures } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { initFixture } from "./ui/fixture.js";

/** A geometry leaf stub with a real `_path` element the class toggle writes. */
const leafWithPath = (): L.Layer => {
  const el = document.createElement("path");
  return { _path: el } as unknown as L.Layer;
};

/** A hand-built §9 snapshot: 3 geometry leaves with a numeric `value` field.
 *  Filtering `value` to [2, 5] hides the first leaf (1) and keeps the last
 *  two (2, 5). */
const makeFeatures = (): LayerFilterFeatures => ({
  features: [
    { leaf: leafWithPath(), fields: { value: 1 } },
    { leaf: leafWithPath(), fields: { value: 2 } },
    { leaf: leafWithPath(), fields: { value: 5 } },
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
        (leaf as { _path: HTMLElement })._path.classList.contains(
          CONST.CLASSES.FILTER_HIDDEN,
        );
      expect(path(a.leaf)).toBe(true);
      expect(path(b.leaf)).toBe(false);
      expect(path(c.leaf)).toBe(false);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("clears the class for every leaf when the filter is removed", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      manager.setLayerFilter("flt1", between("value", [2, 5]));
      manager.setLayerFilter("flt1", undefined);
      const path = (leaf: L.Layer) =>
        (leaf as { _path: HTMLElement })._path.classList.contains(
          CONST.CLASSES.FILTER_HIDDEN,
        );
      for (const feature of features.features) {
        expect(path(feature.leaf)).toBe(false);
      }
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
