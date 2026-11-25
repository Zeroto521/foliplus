// test/js/control/LayerControl/controller.count — point extraction and feature counts.
import {
  createLayerControllerFixture,
  teardownLayerControllerFixture,
} from "./controller.fixture.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { GEOM_TYPE } from "#core/layer/index.js";
import { type LayerController } from "#control/LayerControl/controller.js";

describe("LayerController", () => {
  let manager: LayerController;
  let map: any;

  beforeEach(() => {
    ({ manager, map } = createLayerControllerFixture());
  });

  afterEach(() => {
    teardownLayerControllerFixture(manager);
  });

  // ── traverse / extractPoints ──

  it("extractPoints returns empty array for non-existent layer", () => {
    expect(manager.extractPoints("nonexistent")).toEqual([]);
  });

  it("extractPoints collects markers with features", () => {
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const marker = new Marker() as any;
    marker.feature = { type: "Feature" };
    marker.getLatLng = () => ({ lat: 1, lng: 2 });
    marker.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "pts",
      name: "Pts",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => cb(marker),
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("pts");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker }]);
  });

  it("forEachPoint walks markers without extracting coordinates", () => {
    // The lazy twin of extractPoints: field scans only read the marker, so
    // the traversal must not allocate {lat, lng, marker} or call getLatLng.
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const first = new Marker() as any;
    first.feature = { type: "Feature" };
    first.getLatLng = vi.fn(() => ({ lat: 1, lng: 2 }));
    first.options = {};
    const second = new Marker() as any;
    second.feature = { type: "Feature" };
    second.getLatLng = vi.fn(() => ({ lat: 3, lng: 4 }));
    second.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "lazy",
      name: "Lazy",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(first);
          cb(second);
          cb(first);
        },
        options: {},
      } as any,
    });

    const seen: unknown[] = [];
    manager.forEachPoint("lazy", marker => seen.push(marker));

    // Both markers reached the callback, and no coordinate extraction paid.
    expect(seen).toContain(first);
    expect(seen).toContain(second);
    expect(first.getLatLng).not.toHaveBeenCalled();
    expect(second.getLatLng).not.toHaveBeenCalled();
  });

  it("extractPoints excludes label markers (no double-counting)", () => {
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const data = new Marker() as any;
    data.feature = { type: "Feature" };
    data.getLatLng = () => ({ lat: 1, lng: 2 });
    data.options = {};
    const label = new Marker() as any;
    label.feature = { type: "Feature" };
    label.getLatLng = () => ({ lat: 9, lng: 9 });
    label.options = {};
    label.isLabel = true;
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "el",
      name: "El",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(data);
          cb(label);
        },
        options: {},
      } as any,
    });
    const pts = manager.extractPoints("el");
    expect(pts).toEqual([{ lat: 1, lng: 2, marker: data }]);
  });

  it("extractPoints rejects a plain Marker without .feature, matching the icon contract", () => {
    // countFeatureGeometry counts a plain Marker (no .feature) as a point, but
    // the layer's type icon shows "unknown" because .feature is required to
    // extract coordinates/properties.  extractPoints is that same .feature
    // gate, so a plain Marker must be rejected here too — otherwise the icon's
    // "unknown" promise would diverge from downstream behavior.
    // A Marker WITH .feature (consumable) is extracted, proving the gate is
    // specifically the missing envelope, not Marker identity.
    class Marker {
      getElement() {
        return null;
      }
    }
    window.L.Marker = Marker;
    const plain = new Marker() as any; // no .feature
    plain.getLatLng = () => ({ lat: 1, lng: 2 });
    plain.options = {};
    const consumed = new Marker() as any;
    consumed.feature = { type: "Feature", properties: {} };
    consumed.getLatLng = () => ({ lat: 3, lng: 4 });
    consumed.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "mixed",
      name: "Mixed",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(plain);
          cb(consumed);
        },
        options: {},
      } as any,
    });
    // count treats both as points (count==2), but extractPoints returns only
    // the consumable one — the count-vs-consumable contract held.
    expect(manager.getFeatureCount("mixed")).toBe(2);
    const pts = manager.extractPoints("mixed");
    expect(pts.length).toBe(1);
    expect(pts[0].marker).toBe(consumed);
  });

  it("extractPoints skips leaves that are not point markers", () => {
    // A line leaf is a legitimate child of a registered group, but it has no
    // latlng — the guard drops it instead of calling getLatLng on it.
    const line = new (window.L.Polyline as any)();
    line.options = {};
    manager.map.hasLayer.mockReturnValue(false);
    manager.registerLayer({
      id: "lines",
      name: "Lines",
      layer: {
        eachLayer: (cb: (l: unknown) => void) => {
          cb(line);
        },
        options: {},
      } as any,
    });
    expect(manager.extractPoints("lines")).toEqual([]);
  });

  describe("getFeatureCount", () => {
    // Build a leaf that looks like a real Leaflet layer (has options) so
    // registerLayer's discoverChildPanes does not fail, and that carries
    // the constructor identity forEachLeaf's instanceof checks need.
    const makeLeaf = (ctor: any, extra: Record<string, unknown> = {}) =>
      Object.assign(Object.create(ctor.prototype), {
        options: {},
        // A detached leaf has no element yet, and pinLateContent reads it.
        getElement: () => null,
        ...extra,
      });
    const wrap = (...leaves: unknown[]) =>
      ({
        options: {},
        eachLayer: (cb: (l: unknown) => void) => leaves.forEach(cb),
      }) as any;

    beforeEach(() => {
      manager.map.hasLayer.mockReturnValue(false);
    });

    it("returns undefined for a base layer (id exists, no countable features)", () => {
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        role: "base",
      });
      expect(manager.getFeatureCount("b1")).toBe(undefined);
    });

    it("returns null for an unknown layer id (not found)", () => {
      expect(manager.getFeatureCount("ghost")).toBe(null);
    });

    it("returns undefined for a canvas/unknown layer without a provider", () => {
      manager.registerLayer({ id: "c1", name: "Canvas", layer: { options: {} } });
      expect(manager.getFeatureCount("c1")).toBe(undefined);
    });

    it("prefers the third-party featureCountProvider over forEachLeaf", () => {
      const provider = vi.fn(() => 999);
      manager.registerLayer({
        id: "pv",
        name: "PV",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("pv")).toBe(999);
      expect(provider).toHaveBeenCalledTimes(1);
    });

    it("passes featureCountProvider through createLayerInfo (survives registration)", () => {
      const provider = vi.fn(() => 7);
      manager.registerLayer({
        id: "surv",
        name: "Surv",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      const li = manager.layerRegistry.get("surv");
      expect(typeof li?.featureCountProvider).toBe("function");
      expect(manager.getFeatureCount("surv")).toBe(7);
    });

    it("logs an error when featureCountProvider throws", () => {
      const provider = vi.fn(() => {
        throw new Error("provider boom");
      });
      const logSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      manager.registerLayer({
        id: "boom",
        name: "Boom",
        layer: { options: {} },
        featureCountProvider: provider,
      });
      expect(manager.getFeatureCount("boom")).toBe(undefined);
      expect(logSpy).toHaveBeenCalled();
      expect(logSpy.mock.calls[0][0]).toContain("featureCountProvider threw");
      logSpy.mockRestore();
    });

    it("counts polygons in a feature group via forEachLeaf fallback", () => {
      const layer = wrap(makeLeaf(window.L.Polygon), makeLeaf(window.L.Polygon));
      manager.registerLayer({ id: "poly", name: "Poly", layer });
      expect(manager.getFeatureCount("poly")).toBe(2);
    });

    it("counts all markers, including markers without feature", () => {
      // A plain folium.Marker() has no .feature; both markers are data points.
      const m1 = makeLeaf(window.L.Marker, { feature: {} });
      const m2 = makeLeaf(window.L.Marker);
      const layer = wrap(m1, m2);
      manager.registerLayer({ id: "mk", name: "Mk", layer });
      expect(manager.getFeatureCount("mk")).toBe(2);
    });

    it("returns undefined for a registered layer whose findLayer resolves to nothing", () => {
      manager.registerLayer({ id: "absent", name: "Absent" });
      expect(manager.getFeatureCount("absent")).toBe(undefined);
    });

    it("counts only data features when a label sub-group is nested under mainLayer", () => {
      const dataPoly = makeLeaf(window.L.Polygon);
      const labelPoly = makeLeaf(window.L.Polygon);
      (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
      const labelGroup = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(labelPoly),
      };
      const mainLayer = wrap(dataPoly, labelGroup);
      manager.registerLayer({ id: "nested", name: "Nested", layer: mainLayer });
      expect(manager.getFeatureCount("nested")).toBe(1);
    });
  });

  describe("refreshCount", () => {
    it("emits LAYER_ITEM_COUNT_CHANGE for a registered overlay layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({ id: "rc1", name: "RC", layer: { options: {} } });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("rc1");
      expect(handler).toHaveBeenCalledWith(
        { id: "rc1" },
        { origin: { kind: "programmatic", via: "refresh" } },
      );
    });

    it("does not emit for a base layer", () => {
      manager.map.hasLayer.mockReturnValue(false);
      manager.registerLayer({
        id: "b1",
        name: "B",
        layer: { options: {} },
        role: "base",
      });
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("b1");
      expect(handler).not.toHaveBeenCalled();
    });

    it("emits without touching the cached type; invalidation belongs to the content-change path", () => {
      manager.map.hasLayer.mockReturnValue(false);
      const poly = Object.assign(Object.create(window.L.Polygon.prototype), {
        options: {},
      });
      const polyLayer = {
        options: {},
        eachLayer: (cb: (l: unknown) => void) => cb(poly),
      };
      manager.registerLayer({ id: "rt", name: "RT", layer: polyLayer });
      expect(manager.getLayerType("rt")).toBe(GEOM_TYPE.POLYGON);
      // refreshCount is emit-only: LayerFactory invalidates on add/remove/clear,
      // so a caller that mutates geometry must invalidateType itself. The
      // snapshot survives a bare count notification.
      manager.refreshCount("rt");
      const layerInfo = manager.layerRegistry.get("rt");
      expect(layerInfo?.type).toBe(GEOM_TYPE.POLYGON);
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("rt");
      expect(handler).toHaveBeenCalledWith(
        { id: "rt" },
        { origin: { kind: "programmatic", via: "refresh" } },
      );
      manager.invalidateType("rt");
      expect(manager.layerRegistry.get("rt")?.type).toBeNull();
    });

    it("emits for an unknown layer id (no-op subscriber; defensive)", () => {
      const bus = map.foliplus!.events;
      const handler = vi.fn();
      bus.on(EVENTS.LAYER_ITEM_COUNT_CHANGE, handler);
      manager.refreshCount("ghost");
      expect(handler).toHaveBeenCalledWith(
        { id: "ghost" },
        { origin: { kind: "programmatic", via: "refresh" } },
      );
    });
  });
});
