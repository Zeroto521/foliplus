import { initFixture, makeAuthorIcon, polygonLayer } from "./ui/fixture.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { type LayerFilterFeatures } from "#core/layer/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { type LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";
import { commitGlyph } from "#control/LayerControl/ui/style/icon.js";
import { FACE, flushStyleDimApply } from "#control/LayerControl/ui/style/styleBag.js";

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

// The shared L.stamp stub (vi.fn(() => ++id)) re-issues a new id on every
// call, so two `L.stamp(sameLayer)` calls disagree and the layeradd handler's
// stamp match fails. Memoize one id per object like controller.test.ts does.
const stableStamp = vi.fn(
  (obj: unknown) => ((obj as { __id?: number }).__id ??= ++stableStampId),
);
let stableStampId = 1000;

describe("generic data-layer filter (controller wiring)", () => {
  let manager: LayerController;
  let ui: LayerUI;
  let map: L.Map;

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
    map = fixture.map;
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
    it("applies an enum filter to the matching values only", () => {
      // Three leaves: a/1, b/2, c/5. An enum filter on kind=b keeps b only.
      const leaves = [leafWithElement(), leafWithElement(), leafWithElement()];
      leaves[0].feature = { properties: { kind: "a" } };
      leaves[1].feature = { properties: { kind: "b" } };
      leaves[2].feature = { properties: { kind: "c" } };
      const features: LayerFilterFeatures = {
        features: [
          { leaf: leaves[0], fields: { kind: "a" } },
          { leaf: leaves[1], fields: { kind: "b" } },
          { leaf: leaves[2], fields: { kind: "c" } },
        ],
        total: 3,
        numericFields: [],
        ranges: {},
        enumFields: ["kind"],
        enumValues: { kind: ["a", "b", "c"] },
      };
      ui.runtimeStore.setFilterFeatures("flt1", features);

      manager.setLayerFilter("flt1", { kind: "enum", field: "kind", values: ["b"] });

      const path = (leaf: L.Layer) =>
        (leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
      expect(path(leaves[0])).toBe(true);
      expect(path(leaves[1])).toBe(false);
      expect(path(leaves[2])).toBe(true);
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

    it("the layeradd handler replays a committed filter onto a re-added layer", () => {
      // The 415-419 replay branch only runs when a filter is committed and a
      // layer rejoins the map; the direct replayFilter tests above cover the
      // method but not the layeradd wiring. A re-add recreates the leaf's DOM
      // element (dropping the class), so the handler must re-apply it. The
      // shared L.stamp stub is not stable per object, so swap in a memoizing
      // one for the stamp match the handler performs.
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        const features = makeFeatures();
        manager.registerLayer({ id: "late", name: "Late", role: "overlay" });
        ui.runtimeStore.setFilterFeatures("late", features);
        manager.setLayerFilter("late", between("value", [2, 5]));
        const [a] = features.features;
        const path = (leaf: L.Layer) =>
          (leaf as { getElement: () => HTMLElement })
            .getElement()
            .classList.contains(CONST.CLASSES.FILTER_HIDDEN);
        expect(path(a.leaf)).toBe(true);
        (a.leaf as { getElement: () => HTMLElement })
          .getElement()
          .classList.remove(CONST.CLASSES.FILTER_HIDDEN);
        expect(path(a.leaf)).toBe(false);
        // The real object joins the map after the filter was committed; the
        // layeradd handler must match it by stamp and re-apply the class.
        const arrived = new window.L.Path();
        map._layers["late"] = arrived;
        manager.onLayerAdd({ layer: arrived });
        expect(path(a.leaf)).toBe(true);
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("the layeradd replay leaves a layer that is not findable alone", () => {
      // The replay's resolved check also needs the false side: a layer joins
      // the map but is not findable (not in the internal registry), so the
      // handler must not crash and must not re-apply a class to nothing.
      const realStamp = window.L.stamp;
      window.L.stamp = stableStamp;
      try {
        const features = makeFeatures();
        manager.registerLayer({ id: "late", name: "Late", role: "overlay" });
        ui.runtimeStore.setFilterFeatures("late", features);
        manager.setLayerFilter("late", between("value", [2, 5]));
        const stranger = new window.L.Path();
        manager.onLayerAdd({ layer: stranger });
        expect(manager.layerRegistry.get("late")?.layer).toBeNull();
        expect(manager.layerRegistry.get("late")?.filterProvider).toBeTypeOf(
          "function",
        );
      } finally {
        window.L.stamp = realStamp;
      }
    });

    it("deleteFilterFeatures drops the snapshot and prunes the row", () => {
      const features = makeFeatures();
      ui.runtimeStore.setFilterFeatures("flt1", features);
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBe(features);
      ui.runtimeStore.deleteFilterFeatures("flt1");
      expect(ui.runtimeStore.getFilterFeatures("flt1")).toBeUndefined();
    });

    it("deleteFilterFeatures on an unknown id is a no-op", () => {
      // The row-missing branch: deleting a snapshot for a layer that was
      // never registered must not throw or touch anything.
      expect(() => ui.runtimeStore.deleteFilterFeatures("nope")).not.toThrow();
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

  describe("declared filter seeding (per-layer declaration → committed filter)", () => {
    it("seeds a declared filter as the layer's initial committed filter", () => {
      const { manager } = initFixture({
        data: [
          {
            id: "flt1",
            name: "Filtered",
            role: "overlay",
            layer: polygonLayer(),
            filter: between("value", [2, 8]),
          },
          { id: "plain", name: "Plain", role: "overlay", layer: polygonLayer() },
        ],
      });
      expect(manager.layerRegistry.get("flt1")?.filter).toEqual(
        between("value", [2, 8]),
      );
      expect(manager.layerRegistry.get("plain")?.filter).toBeUndefined();
    });
  });
});

describe("filter hidden-class survives a glyph rebuild (controller-side)", () => {
  class TestDivIcon {
    options: any;
    constructor(options: any) {
      this.options = options;
    }
  }
  (window.L as any).Icon = { Default: class {} };
  (window.L as any).DivIcon = TestDivIcon;
  (window.L as any).divIcon = vi.fn((options: any) => new TestDivIcon(options));
  const makeRebuildMarker = (authorIcon: unknown): any => {
    let iconEl: HTMLElement | null = null;
    const leaf: any = {
      options: { icon: authorIcon },
      feature: { properties: { value: 1 } },
      getElement: () => iconEl,
      setIcon: vi.fn((next: unknown) => {
        leaf.options.icon = next;
        iconEl =
          typeof (next as { createIcon?: unknown })?.createIcon === "function"
            ? (next as { createIcon: () => HTMLElement }).createIcon()
            : document.createElement("div");
        return leaf;
      }),
    };
    leaf.setIcon(authorIcon);
    return leaf;
  };
  const makeMarkerGroup = (...markers: any[]): any => ({
    options: {},
    eachLayer: vi.fn((fn: (child: unknown) => void) => {
      for (const marker of markers) fn(marker);
    }),
  });
  const BASE_LAYER = {
    id: "base1",
    name: "OSM",
    role: "base",
    layer: { options: {}, setZIndex: vi.fn() } as never,
    paneName: "tilePane",
  };
  const featuresOf = (leaf: unknown): LayerFilterFeatures => ({
    features: [{ leaf: leaf as any, fields: { value: 1 } }],
    total: 1,
    numericFields: ["value"],
    ranges: { value: [1, 1] },
    enumFields: [],
    enumValues: {},
  });
  const hasHiddenClass = (el: HTMLElement | null) =>
    !!el?.classList.contains(CONST.CLASSES.FILTER_HIDDEN);

  it("a glyph change that rebuilds the icon must not drop the hidden class", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) =>
        ({
          content: pseudo === "::before" ? '"\\f00a"' : "none",
        }) as CSSStyleDeclaration,
    );
    const authorIcon = makeAuthorIcon();
    const marker = makeRebuildMarker(authorIcon);
    const layer = makeMarkerGroup(marker);
    const { manager: m, ui: u } = initFixture({
      data: [{ id: "flt1", name: "Flt", role: "overlay", layer }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    u.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    m.setLayerFilter("flt1", between("value", [2, 5]));
    const firstEl = marker.getElement();
    expect(hasHiddenClass(firstEl)).toBe(true);
    expect(m.hiddenSets.get("flt1")?.has(marker)).toBe(true);
    const elementBefore = marker.getElement();
    commitGlyph(u, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");
    const elementAfter = marker.getElement();
    expect(elementAfter).not.toBe(elementBefore);
    expect(marker.setIcon).toHaveBeenCalled();
    const labelWillSkip = m.hiddenSets.get("flt1")?.has(marker) ?? false;
    const domHidden = hasHiddenClass(elementAfter);
    expect(domHidden).toBe(labelWillSkip);
    expect(domHidden).toBe(true);
  });

  it("a layer with no committed filter keeps its rebuilt element unclassed", () => {
    vi.spyOn(window, "getComputedStyle").mockImplementation(
      (el: Element, pseudo?: string | null) =>
        ({
          content: pseudo === "::before" ? '"\\f00a"' : "none",
        }) as CSSStyleDeclaration,
    );
    const authorIcon = makeAuthorIcon();
    const marker = makeRebuildMarker(authorIcon);
    const layer = makeMarkerGroup(marker);
    const { manager: m, ui: u } = initFixture({
      data: [{ id: "flt1", name: "Flt", role: "overlay", layer }, BASE_LAYER],
    });
    window.localStorage.removeItem(CONST.STORAGE.KEY);
    u.runtimeStore.setFilterFeatures("flt1", featuresOf(marker));
    expect(m.layerRegistry.get("flt1")?.filter).toBeUndefined();
    expect(hasHiddenClass(marker.getElement())).toBe(false);
    commitGlyph(u, "flt1", "star");
    flushStyleDimApply(FACE.ICON, "flt1");
    expect(marker.setIcon).toHaveBeenCalled();
    expect(hasHiddenClass(marker.getElement())).toBe(false);
    expect(m.hiddenSets.get("flt1")).toBeUndefined();
  });
});
