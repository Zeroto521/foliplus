// Unit tests for core/layer/snapshot — the layer's point snapshot builder.
//
// The builder walks every leaf exactly once, dedupes by `L.stamp`, skips
// label leaves, and normalises each marker's numeric fields to one flat
// record. Numeric strictness is shared across the data layer
// (`typeof v === "number" && Number.isFinite(v)`), so a NaN or ±Infinity
// in a source field never reaches a predicate.
//
// A same-key collision between an explicit contract (`value` or
// `options.value`) and a numeric `feature.properties.<key>` warns once
// per layer, not once per point — the Set dedupes across the walk so a
// hot layer does not spam the console.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLayerSnapshot,
  extractMarkerFields,
  snapshotFromPoints,
} from "#core/layer/snapshot.js";
import { createLogger } from "#common/log.js";

// Minimal Leaflet classes for `instanceof` checks in the builder. The
// base setup does not install `L.Marker` (only `L.marker` factory and
// `L.CircleMarker`), so each test file that reaches `instanceof` brings
// its own class stubs.
class Marker {}

class CircleMarker {}

beforeEach(() => {
  window.L.Marker = Marker;
  window.L.CircleMarker = CircleMarker;
  // A fresh stamp counter — a shared id across the walk collapses distinct
  // markers into one row, which is what the dedupe test needs to exercise.
  let id = 0;
  window.L.stamp = vi.fn(() => ++id);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A Leaflet-style container that walkLeaf can descend into.
const group = (...children: unknown[]) => ({
  eachLayer: (fn: (l: unknown) => void) => children.forEach(fn),
});

// A marker instance the builder recognises. Options are set via Object
// assignment because the class stubs have no field declarations.
const makeMarker = (opts: {
  lat?: number;
  lng?: number;
  value?: number;
  options?: { value?: number };
  feature?: { properties?: Record<string, unknown> };
  isLabel?: boolean;
}): L.Marker => {
  const m = new Marker() as any;
  m.getLatLng = () => ({ lat: opts.lat ?? 0, lng: opts.lng ?? 0 });
  if (opts.value !== undefined) m.value = opts.value;
  if (opts.options !== undefined) m.options = opts.options;
  if (opts.feature !== undefined) m.feature = opts.feature;
  if (opts.isLabel !== undefined) m.isLabel = opts.isLabel;
  return m;
};

const NOOP_LOGGER = createLogger("test");

describe("buildLayerSnapshot — walk and dedupe", () => {
  it("walks every leaf and preserves walk order", () => {
    const a = makeMarker({ lat: 1, lng: 1, feature: { properties: { count: 1 } } });
    const b = makeMarker({ lat: 2, lng: 2, feature: { properties: { count: 2 } } });
    const c = makeMarker({ lat: 3, lng: 3, feature: { properties: { count: 3 } } });
    const snap = buildLayerSnapshot(group(a, b, c), NOOP_LOGGER);
    expect(snap.points.map(p => [p.lat, p.lng])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it("skips label leaves entirely", () => {
    const labelled = makeMarker({ lat: 99, lng: 99, isLabel: true });
    const a = makeMarker({ lat: 1, lng: 1, feature: { properties: { count: 1 } } });
    const snap = buildLayerSnapshot(group(labelled, a), NOOP_LOGGER);
    expect(snap.points).toHaveLength(1);
    expect(snap.points[0].lat).toBe(1);
  });

  it("skips markers without a feature", () => {
    const bare = makeMarker({ lat: 1, lng: 1 });
    const snap = buildLayerSnapshot(group(bare), NOOP_LOGGER);
    expect(snap.points).toHaveLength(0);
  });

  it("includes a marker whose feature carries no properties — normalisation yields empty fields", () => {
    const m = makeMarker({ lat: 1, lng: 1, feature: {} });
    const snap = buildLayerSnapshot(group(m), NOOP_LOGGER);
    expect(snap.points).toHaveLength(1);
    expect(snap.points[0].fields).toEqual({});
    expect(snap.numericFields).toEqual([]);
    expect(snap.ranges).toEqual({});
  });

  it("skips a marker whose getLatLng returns null", () => {
    const m = makeMarker({ lat: 1, lng: 1, feature: { properties: { count: 1 } } });
    m.getLatLng = () => null;
    const snap = buildLayerSnapshot(group(m), NOOP_LOGGER);
    expect(snap.points).toHaveLength(0);
  });

  it("dedupes markers by stamp — the same object twice yields one row", () => {
    const original = makeMarker({
      lat: 5,
      lng: 5,
      feature: { properties: { count: 1 } },
    });
    // Two references to the same object share an `L.stamp` id, so both
    // leaves collapse into a single point.
    window.L.stamp = vi.fn(() => "same-id");
    const snap = buildLayerSnapshot(group(original, original), NOOP_LOGGER);
    expect(snap.points).toHaveLength(1);
  });

  it("excludes non-point layers from the walk", () => {
    const polygon = { getLatLngs: () => [] };
    const a = makeMarker({ lat: 1, lng: 1, feature: { properties: { count: 1 } } });
    const snap = buildLayerSnapshot(group(polygon, a), NOOP_LOGGER);
    expect(snap.points).toHaveLength(1);
  });
});

describe("buildLayerSnapshot — numeric strictness", () => {
  it("excludes NaN, ±Infinity, and numeric strings", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: {
        properties: {
          ok: 5,
          nan: Number.NaN,
          posInf: Infinity,
          negInf: -Infinity,
          asString: "10",
        },
      },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ ok: 5 });
    expect(snap.numericFields).toEqual(["ok"]);
  });

  it("excludes null and undefined property values", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: {
        properties: {
          nullish: null,
          other: 3,
        },
      },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ other: 3 });
  });

  it("excludes object-typed property values (a label can't render them)", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: {
        properties: {
          style: { color: "#fff" },
          ok: 1,
        },
      },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ ok: 1 });
  });
});

describe("buildLayerSnapshot — field priority", () => {
  it("value wins over options.value", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      value: 7,
      options: { value: 3 },
      feature: { properties: {} },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ value: 7 });
  });

  it("options.value is used when value is absent", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      options: { value: 3 },
      feature: { properties: {} },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ value: 3 });
  });

  it("properties.* falls through when no explicit contract is set", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: { properties: { count: 5, name: "x" } },
    });
    const snap = buildLayerSnapshot(group(a), NOOP_LOGGER);
    expect(snap.points[0].fields).toEqual({ count: 5 });
  });
});

describe("buildLayerSnapshot — collision warning", () => {
  const fakeLog = () => {
    const warn = vi.fn();
    return { log: { warn, error: warn, msg: (s: string) => s } as never, warn };
  };

  it("warns once per layer when properties.value differs from the explicit value", () => {
    const { log, warn } = fakeLog();
    const a = makeMarker({
      lat: 1,
      lng: 1,
      value: 10,
      feature: { properties: { value: 99 } },
    });
    const snap = buildLayerSnapshot(group(a), log);
    expect(snap.points[0].fields).toEqual({ value: 10 });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("dedupes across points — many colliding markers warn once", () => {
    const { log, warn } = fakeLog();
    const mk = (n: number) =>
      makeMarker({
        lat: n,
        lng: n,
        value: 10,
        feature: { properties: { value: 99 } },
      });
    buildLayerSnapshot(group(mk(1), mk(2), mk(3)), log);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the two values agree", () => {
    const { log, warn } = fakeLog();
    const a = makeMarker({
      lat: 1,
      lng: 1,
      value: 10,
      feature: { properties: { value: 10 } },
    });
    buildLayerSnapshot(group(a), log);
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not warn for keys only present in properties", () => {
    const { log, warn } = fakeLog();
    const a = makeMarker({
      lat: 1,
      lng: 1,
      value: 10,
      feature: { properties: { count: 5 } },
    });
    buildLayerSnapshot(group(a), log);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("buildLayerSnapshot — numericFields and ranges", () => {
  it("numericFields is first-seen order across the walk", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: { properties: { first: 1, second: 2 } },
    });
    const b = makeMarker({
      lat: 2,
      lng: 2,
      feature: { properties: { third: 3, first: 4 } },
    });
    const snap = buildLayerSnapshot(group(a, b), NOOP_LOGGER);
    expect(snap.numericFields).toEqual(["first", "second", "third"]);
  });

  it("ranges capture [min, max] over the finite values", () => {
    const a = makeMarker({
      lat: 1,
      lng: 1,
      feature: { properties: { count: 5, name: "x" } },
    });
    const b = makeMarker({
      lat: 2,
      lng: 2,
      feature: { properties: { count: 1 } },
    });
    const c = makeMarker({
      lat: 3,
      lng: 3,
      feature: { properties: { count: 9 } },
    });
    const snap = buildLayerSnapshot(group(a, b, c), NOOP_LOGGER);
    expect(snap.ranges).toEqual({ count: [1, 9] });
  });

  it("returns an empty snapshot for a layer with no points", () => {
    const snap = buildLayerSnapshot(group(), NOOP_LOGGER);
    expect(snap.points).toEqual([]);
    expect(snap.numericFields).toEqual([]);
    expect(snap.ranges).toEqual({});
  });
});

describe("snapshotFromPoints (component-owned extraction)", () => {
  const pt = (fields: Record<string, unknown>, value?: number) => {
    const marker = makeMarker({
      lat: 1,
      lng: 2,
      feature: { properties: fields },
      value,
    });
    return { lat: 1, lng: 2, marker };
  };

  it("normalises fields, keeps walk order, and accumulates ranges", () => {
    const snap = snapshotFromPoints([pt({ b: 10 }, 42), pt({ a: 2 }), pt({ a: 30 })]);
    expect(snap.numericFields).toEqual(["value", "b", "a"]);
    expect(snap.ranges).toEqual({ value: [42, 42], b: [10, 10], a: [2, 30] });
    expect(snap.points.map(p => p.fields)).toEqual([
      { value: 42, b: 10 },
      { a: 2 },
      { a: 30 },
    ]);
  });

  it("works without a logger and for an empty point list", () => {
    expect(snapshotFromPoints([])).toEqual({
      points: [],
      numericFields: [],
      ranges: {},
    });
    const snap = snapshotFromPoints([pt({ a: 1 })]);
    expect(snap.ranges).toEqual({ a: [1, 1] });
  });

  it("extractMarkerFields is the shared normaliser (value wins over properties)", () => {
    const marker = makeMarker({
      value: 42,
      feature: { properties: { value: 7, other: 3 } },
    });
    expect(extractMarkerFields(marker)).toEqual({ value: 42, other: 3 });
  });
});
