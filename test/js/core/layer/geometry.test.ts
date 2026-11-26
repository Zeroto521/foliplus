import { stubLayerClasses } from "./layerStub.fixture.js";
import { beforeEach, describe, expect, it } from "vitest";
import { countFeatureGeometry, getGeometryType } from "#core/layer/index.js";

beforeEach(stubLayerClasses);

describe("getGeometryType", () => {
  const wrap = (...leaves: L.Layer[]) => ({
    eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
  });

  it("returns polygon for L.Polygon leaves", () => {
    const group = wrap(new window.L.Polygon());
    expect(getGeometryType(group as never)).toBe("polygon");
  });

  it("returns line for L.Polyline leaves", () => {
    const group = wrap(new window.L.Polyline());
    expect(getGeometryType(group as never)).toBe("line");
  });

  it("returns point for markers with feature", () => {
    const marker = new window.L.Marker();
    marker.feature = {};
    const group = wrap(marker);
    expect(getGeometryType(group as never)).toBe("point");
  });

  it("returns empty for a group with no leaves", () => {
    const emptyGroup = { eachLayer: () => {} };
    expect(getGeometryType(emptyGroup as never)).toBe("empty");
  });

  it("ignores isLabel leaves when inferring type", () => {
    const label = new window.L.Polygon();
    (label as unknown as { isLabel: boolean }).isLabel = true;
    const group = wrap(label);
    expect(getGeometryType(group as never)).toBe("empty");
  });

  it("infers type from data leaves even when labels are present", () => {
    const dataPoly = new window.L.Polygon();
    const labelPoly = new window.L.Polyline();
    (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
    const group = wrap(dataPoly, labelPoly);
    expect(getGeometryType(group as never)).toBe("polygon");
  });

  it("returns unknown for mixed geometry", () => {
    const group = wrap(new window.L.Polygon(), new window.L.Polyline());
    expect(getGeometryType(group as never)).toBe("unknown");
  });

  it("returns point for CircleMarker leaves with feature", () => {
    const cm = new window.L.CircleMarker();
    cm.feature = {};
    const group = wrap(cm);
    expect(getGeometryType(group as never)).toBe("point");
  });

  it("returns unknown for a CircleMarker without a .feature property", () => {
    // Same consumable-data contract as Marker: extractPoints gates on
    // .feature for CircleMarker too, so the icon must not promise "point"
    // for data downstream cannot consume.
    const cm = new window.L.CircleMarker();
    const group = wrap(cm);
    expect(getGeometryType(group as never)).toBe("unknown");
  });

  it("returns unknown for a Marker without a .feature property", () => {
    // The type icon reflects "structured, consumable point data" (the
    // extractPoints / Heatmap contract), not raw geometry.  A plain
    // folium.Marker() is a geometric point — countFeatureGeometry counts it
    // — but without a GeoJSON envelope it is not consumable point data, so
    // the icon stays unknown to avoid promising Heatmap/export support.
    const marker = new window.L.Marker();
    const group = wrap(marker);
    expect(getGeometryType(group as never)).toBe("unknown");
  });

  it("returns unknown for a mix of Point + LineString + Polygon", () => {
    const marker = new window.L.Marker();
    marker.feature = {};
    const group = wrap(marker, new window.L.Polyline(), new window.L.Polygon());
    expect(getGeometryType(group as never)).toBe("unknown");
  });

  it("treats multiple Markers as point geometry (MultiPoint serialization)", () => {
    const m1 = new window.L.Marker();
    m1.feature = {};
    const m2 = new window.L.Marker();
    m2.feature = {};
    const group = wrap(m1, m2);
    expect(getGeometryType(group as never)).toBe("point");
  });
});
describe("countFeatureGeometry", () => {
  const wrap = (...leaves: L.Layer[]) => ({
    eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
  });

  it("counts Polygon leaves", () => {
    const group = wrap(new window.L.Polygon(), new window.L.Polygon());
    expect(countFeatureGeometry(group as never)).toBe(2);
  });

  it("counts Polyline leaves", () => {
    const group = wrap(new window.L.Polyline());
    expect(countFeatureGeometry(group as never)).toBe(1);
  });

  it("counts CircleMarker leaves as points", () => {
    const group = wrap(new window.L.CircleMarker());
    expect(countFeatureGeometry(group as never)).toBe(1);
  });

  it("counts Markers with feature as points", () => {
    const marker = new window.L.Marker();
    marker.feature = {};
    const group = wrap(marker);
    expect(countFeatureGeometry(group as never)).toBe(1);
  });

  it("counts Markers without feature as points", () => {
    // A plain folium.Marker() renders as L.Marker() with no .feature; it is
    // still a data point feature and must be counted.  .feature is only
    // required by extractPoints / Heatmap property lookup.
    const marker = new window.L.Marker();
    const group = wrap(marker);
    expect(countFeatureGeometry(group as never)).toBe(1);
  });

  it("excludes label layers", () => {
    const polygon = new window.L.Polygon();
    (polygon as unknown as { isLabel: boolean }).isLabel = true;
    const group = wrap(polygon);
    expect(countFeatureGeometry(group as never)).toBe(0);
  });

  it("excludes isLabel CircleMarker", () => {
    const cm = new window.L.CircleMarker();
    (cm as unknown as { isLabel: boolean }).isLabel = true;
    const group = wrap(cm);
    expect(countFeatureGeometry(group as never)).toBe(0);
  });

  it("counts features nested in a label sub-group (real LayerFactory structure)", () => {
    const dataPoly = new window.L.Polygon();
    const labelPoly = new window.L.Polygon();
    (labelPoly as unknown as { isLabel: boolean }).isLabel = true;
    const labelGroup = {
      eachLayer: (fn: (l: L.Layer) => void) => fn(labelPoly),
    };
    const mainGroup = {
      eachLayer: (fn: (l: L.Layer) => void) => {
        fn(dataPoly);
        fn(labelGroup as L.Layer);
      },
    };
    expect(countFeatureGeometry(mainGroup as never)).toBe(1);
  });

  it("handles a mixed group", () => {
    const marker = new window.L.Marker();
    marker.feature = {};
    const label = new window.L.Polygon();
    (label as unknown as { isLabel: boolean }).isLabel = true;
    const group = wrap(new window.L.Polygon(), new window.L.Polyline(), marker, label);
    expect(countFeatureGeometry(group as never)).toBe(3);
  });

  it("returns 0 for an empty group", () => {
    const emptyGroup = { eachLayer: () => {} };
    expect(countFeatureGeometry(emptyGroup as never)).toBe(0);
  });
});
describe("plain Marker count-vs-icon divergence", () => {
  const wrap = (...leaves: L.Layer[]) => ({
    eachLayer: (fn: (l: L.Layer) => void) => leaves.forEach(fn),
  });

  // A plain folium.Marker() (no .feature) is a geometric point but not
  // "structured, consumable point data".  countFeatureGeometry and
  // getGeometryType intentionally use different contracts so the layer
  // panel shows an honest count without implying Heatmap/export support.
  it("counts it as a point but its type icon is unknown", () => {
    const marker = new window.L.Marker();
    const group = wrap(marker);
    expect(countFeatureGeometry(group as never)).toBe(1);
    expect(getGeometryType(group as never)).toBe("unknown");
  });

  it("a Marker with .feature counts as a point and its type is point", () => {
    const marker = new window.L.Marker();
    marker.feature = {};
    const group = wrap(marker);
    expect(countFeatureGeometry(group as never)).toBe(1);
    expect(getGeometryType(group as never)).toBe("point");
  });
});
