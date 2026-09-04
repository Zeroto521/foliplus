// AnnotationManager unit tests.
// Logic under test: value formatting (incl. percent), anchor resolution,
// field/value reading. Uses duck-typed leaf fixtures because the vitest L
// mock does not provide constructible geometry classes.
import { describe, expect, it } from "vitest";
import { AnnotationManager } from "../../../foliplus/js/LayerControl/annotation.js";

describe("AnnotationManager.formatValue", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("auto formats numbers and passes strings through", () => {
    expect(mgr.formatValue("1200", "auto", "en")).toBe("1.2K");
    expect(mgr.formatValue("42", "auto", "en")).toBe("42");
    expect(mgr.formatValue("hello", "auto", "en")).toBe("hello");
  });
  it("int drops grouping and decimals", () => {
    expect(mgr.formatValue("1234.56", "int", "en")).toBe("1235");
  });
  it("comma adds thousands separator", () => {
    expect(mgr.formatValue("6000", "comma", "en")).toBe("6,000");
  });
  it("percent multiplies by 100 and appends %", () => {
    expect(mgr.formatValue("0.35", "percent", "en")).toBe("35%");
    expect(mgr.formatValue("0.123", "percent", "en")).toBe("12.3%");
  });
  it("falls back to raw string for non-numeric values", () => {
    expect(mgr.formatValue("abc", "percent", "en")).toBe("abc");
  });
});

describe("AnnotationManager.resolveAnchor", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("returns the point via getLatLng", () => {
    const leaf = { getLatLng: () => ({ lat: 40, lng: -74 }) };
    const anchor = mgr.resolveAnchor(leaf as L.Layer);
    expect(anchor?.lat).toBeCloseTo(40);
    expect(anchor?.lng).toBeCloseTo(-74);
  });
  it("returns bounds center for non-point leaves", () => {
    const leaf = {
      getBounds: () => ({
        isValid: () => true,
        getCenter: () => ({ lat: 40.5, lng: -73.5 }),
      }),
    };
    const anchor = mgr.resolveAnchor(leaf as L.Layer);
    expect(anchor?.lat).toBeCloseTo(40.5);
    expect(anchor?.lng).toBeCloseTo(-73.5);
  });
  it("returns null when the leaf has no geometry accessor", () => {
    const anchor = mgr.resolveAnchor({} as L.Layer);
    expect(anchor).toBeNull();
  });
});

describe("AnnotationManager.readFieldValue", () => {
  const mgr = new AnnotationManager(map, () => null);
  it("reads values from feature.properties", () => {
    const leaf = { feature: { properties: { name: "x", count: 7 } } };
    expect(mgr.readFieldValue(leaf as L.Layer, "name")).toBe("x");
    expect(mgr.readFieldValue(leaf as L.Layer, "count")).toBe("7");
  });
  it("returns null when the field is missing", () => {
    const leaf = { feature: { properties: { name: "x" } } };
    expect(mgr.readFieldValue(leaf as L.Layer, "missing")).toBeNull();
  });
  it("returns null for a leaf without feature.properties", () => {
    expect(mgr.readFieldValue({} as L.Layer, "name")).toBeNull();
  });
});

describe("AnnotationManager config round-trip", () => {
  it("stores and retrieves config", () => {
    const mgr = new AnnotationManager(map, () => null);
    const cfg = { show: true, field: "name", format: "auto" };
    mgr.setConfig("layer-1", cfg);
    expect(mgr.getConfig("layer-1")).toEqual(cfg);
    expect(mgr.getConfig("layer-2")).toEqual({
      show: false,
      field: "",
      format: "auto",
    });
    expect(mgr.configEntries()).toHaveLength(1);
  });
});
