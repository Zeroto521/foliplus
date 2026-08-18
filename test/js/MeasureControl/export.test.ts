import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as Export from "#foliplus/MeasureControl/export.js";

// ── Test data fixtures ──

const markerData: MeasureData = {
  id: "foliplus_measure_marker_1000_1",
  type: CONST.MODE.MARKER,
  lng: 119.3,
  lat: 26.08,
  address: "Taiwan",
};

const distanceData: MeasureData = {
  id: "foliplus_measure_distance_1000_2",
  type: CONST.MODE.DISTANCE,
  points: [
    { lng: 119.3, lat: 26.08 },
    { lng: 119.31, lat: 26.09 },
    { lng: 119.32, lat: 26.1 },
  ],
  segments: [
    { lng: 119.31, lat: 26.09, distance: 1500 },
    { lng: 119.32, lat: 26.1, distance: 2200 },
  ],
  totalDistance: 3700,
};

const polygonData: MeasureData = {
  id: "foliplus_measure_polygon_1000_3",
  type: CONST.MODE.POLYGON,
  points: [
    { lng: 119.3, lat: 26.08 },
    { lng: 119.32, lat: 26.08 },
    { lng: 119.32, lat: 26.1 },
    { lng: 119.3, lat: 26.1 },
  ],
  segments: [
    { lng: 119.32, lat: 26.08, distance: 1500 },
    { lng: 119.32, lat: 26.1, distance: 2200 },
    { lng: 119.3, lat: 26.1, distance: 1500 },
  ],
  area: 3300000,
};

const circleData: MeasureData = {
  id: "foliplus_measure_circle_1000_4",
  type: CONST.MODE.CIRCLE,
  center: { lng: 119.3, lat: 26.08 },
  target: { lng: 119.31, lat: 26.08 },
  radius: 5000,
};

describe("Export.EXPORT_FORMAT constants", () => {
  it("defines GEOJSON format", () => {
    expect(CONST.EXPORT_FORMAT.GEOJSON).toBe("geojson");
  });
  it("defines CSV format", () => {
    expect(CONST.EXPORT_FORMAT.CSV).toBe("csv");
  });
});

describe("Export.getDefaultFormat", () => {
  it("returns geojson as default when CONF.export_format is missing", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl" };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    (window as any).CONF = prev;
  });

  it("returns geojson from CONF", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "geojson" };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    (window as any).CONF = prev;
  });

  it("returns csv from CONF", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "csv" };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.CSV);
    (window as any).CONF = prev;
  });

  it("returns geojson fallback for unknown format", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "unknown" };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    (window as any).CONF = prev;
  });
});

describe("Export.toGeoJSON", () => {
  it("converts marker to Point feature", () => {
    const json = Export.toGeoJSON([markerData]);
    const data = JSON.parse(json);
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Point");
    expect(data.features[0].geometry.coordinates).toEqual([119.3, 26.08]);
    expect(data.features[0].properties.type).toBe("marker");
    expect(data.features[0].properties.name).toBe("Taiwan");
  });

  it("converts distance to LineString feature", () => {
    const json = Export.toGeoJSON([distanceData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("LineString");
    expect(data.features[0].geometry.coordinates).toEqual([
      [119.3, 26.08],
      [119.31, 26.09],
      [119.32, 26.1],
    ]);
    expect(data.features[0].properties.totalDistance).toBe(3700);
    expect(data.features[0].properties.segments.length).toBe(2);
  });

  it("converts polygon to closed Polygon feature", () => {
    const json = Export.toGeoJSON([polygonData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Polygon");
    const coords = data.features[0].geometry.coordinates[0];
    expect(coords.length).toBe(5); // 4 points + closed back to first
    expect(coords[0]).toEqual(coords[4]); // first == last
    expect(data.features[0].properties.area).toBe(3300000);
  });

  it("converts circle to Polygon feature with 8 points", () => {
    const json = Export.toGeoJSON([circleData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Polygon");
    const coords = data.features[0].geometry.coordinates[0];
    // 8 circle points + 1 closed = 9 coordinates
    expect(coords.length).toBe(9);
    expect(coords[0]).toEqual(coords[8]); // closed
    expect(data.features[0].properties.radius).toBe(5000);
  });

  it("handles empty array", () => {
    const json = Export.toGeoJSON([]);
    const data = JSON.parse(json);
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBe(0);
  });

  it("handles multiple measurement types", () => {
    const json = Export.toGeoJSON([markerData, distanceData, polygonData, circleData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(4);
    expect(data.features.map(f => f.geometry.type)).toEqual([
      "Point",
      "LineString",
      "Polygon",
      "Polygon",
    ]);
  });
});

describe("Export.toCSV", () => {
  it("produces CSV with header and rows", () => {
    const csv = Export.toCSV([markerData, distanceData]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(3); // header + 2 data rows
    const header = lines[0].split(",");
    expect(header).toContain("id");
    expect(header).toContain("type");
    expect(header).toContain("name");
    expect(header).toContain("latitude");
    expect(header).toContain("longitude");
    expect(header).toContain("totalDistance");
    expect(header).toContain("area");
    expect(header).toContain("radius");
    expect(header).toContain("address");
    expect(header).toContain("wkt");
  });

  it("marker row includes address", () => {
    const csv = Export.toCSV([markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain("Taiwan");
    expect(markerRow).toContain("26.080000");
    expect(markerRow).toContain("119.300000");
  });

  it("distance row includes totalDistance", () => {
    const csv = Export.toCSV([distanceData]);
    const lines = csv.split("\n");
    const distRow = lines[1];
    expect(distRow).toContain("3700");
  });

  it("polygon row includes area", () => {
    const csv = Export.toCSV([polygonData]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("3300000");
  });

  it("circle row includes radius", () => {
    const csv = Export.toCSV([circleData]);
    const lines = csv.split("\n");
    const circleRow = lines[1];
    expect(circleRow).toContain("5000");
  });

  it("wkt column contains WKT geometry", () => {
    const csv = Export.toCSV([distanceData]);
    const lines = csv.split("\n");
    const distRow = lines[1];
    expect(distRow).toContain("LINESTRING(119.3");
  });

  it("wkt polygon is a closed ring", () => {
    const csv = Export.toCSV([polygonData]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("POLYGON((119.3");
  });

  it("wkt marker is a POINT", () => {
    const csv = Export.toCSV([markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain("POINT(119.3");
  });
});

describe("Export.getBasePoint", () => {
  it("returns lat/lng from a marker measurement", () => {
    const point = Export.getBasePoint(markerData);
    expect(point).toEqual({ lat: 26.08, lng: 119.3 });
  });

  it("returns the first point from a distance measurement", () => {
    const point = Export.getBasePoint(distanceData);
    expect(point).toEqual({ lat: 26.08, lng: 119.3 });
  });

  it("returns the first point from a polygon measurement", () => {
    const point = Export.getBasePoint(polygonData);
    expect(point).toEqual({ lat: 26.08, lng: 119.3 });
  });

  it("returns the center from a circle measurement", () => {
    const point = Export.getBasePoint(circleData);
    expect(point).toEqual({ lat: 26.08, lng: 119.3 });
  });

  it("returns null when the type is unknown", () => {
    const point = Export.getBasePoint({
      type: "unknown",
    } as MeasureData);
    expect(point).toBeNull();
  });
});

describe("Export.formatToExtension", () => {
  it("returns geojson extension for geojson format", () => {
    expect(Export.formatToExtension("geojson")).toBe("geojson");
  });

  it("returns csv extension for csv format", () => {
    expect(Export.formatToExtension("csv")).toBe("csv");
  });

  it("returns geojson extension for unknown format", () => {
    expect(Export.formatToExtension("unknown" as never)).toBe("geojson");
  });
});

describe("Export.formatToMimeType", () => {
  it("returns application/geo+json for geojson format", () => {
    expect(Export.formatToMimeType("geojson")).toBe("application/geo+json");
  });

  it("returns text/csv for csv format", () => {
    expect(Export.formatToMimeType("csv")).toBe("text/csv");
  });

  it("returns application/geo+json for unknown format", () => {
    expect(Export.formatToMimeType("unknown" as never)).toBe("application/geo+json");
  });
});

describe("Export.exportMeasurements", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalCreateElement: typeof document.createElement;
  let originalAppendChild: typeof HTMLBodyElement.prototype.appendChild;
  let createdUrls: string[] = [];
  let lastAnchor: any = null;

  beforeEach(() => {
    createdUrls = [];
    lastAnchor = null;

    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", filename: "test_data" };

    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      const url = "blob:test-url";
      createdUrls.push(url);
      return url;
    }) as any;

    originalCreateElement = document.createElement;
    document.createElement = vi.fn((tag: string) => {
      if (tag === "a") {
        const anchor = {
          href: "",
          download: "",
          style: {},
          click: vi.fn(),
        };
        lastAnchor = anchor;
        return anchor as any;
      }
      return originalCreateElement(tag);
    }) as any;

    originalAppendChild = HTMLBodyElement.prototype.appendChild;
    HTMLBodyElement.prototype.appendChild = vi.fn() as any;
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    document.createElement = originalCreateElement;
    HTMLBodyElement.prototype.appendChild = originalAppendChild;
    (window as any).CONF = undefined;
  });

  it("creates a download with geojson format and correct filename", () => {
    Export.exportMeasurements([markerData], "geojson");

    expect(createdUrls.length).toBe(1);
    expect(lastAnchor.href).toBe("blob:test-url");
    expect(lastAnchor.download.startsWith("test_data_")).toBe(true);
    expect(lastAnchor.download.endsWith(".geojson")).toBe(true);
    expect(lastAnchor.click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("creates a download with csv format and correct filename", () => {
    Export.exportMeasurements([markerData], "csv");

    expect(createdUrls.length).toBe(1);
    expect(lastAnchor.download.endsWith(".csv")).toBe(true);
    expect(lastAnchor.click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it("does nothing when measurements is empty", () => {
    Export.exportMeasurements([], "geojson");
    expect(createdUrls.length).toBe(0);
  });

  it("does nothing when measurements is null", () => {
    Export.exportMeasurements(null as any, "geojson");
    expect(createdUrls.length).toBe(0);
  });
});

describe("Export.csvEscape", () => {
  it("does not escape simple values", () => {
    expect(Export.csvEscape("hello")).toBe("hello");
    expect(Export.csvEscape(42)).toBe("42");
    expect(Export.csvEscape("")).toBe("");
  });

  it("escapes values containing commas", () => {
    expect(Export.csvEscape("a, b")).toBe('"a, b"');
  });

  it("escapes values containing double quotes", () => {
    expect(Export.csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it("escapes values containing newlines", () => {
    expect(Export.csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("Export.getNameForType", () => {
  it("returns address for marker with address", () => {
    expect(Export.getNameForType(markerData)).toBe("Taiwan");
  });

  it("returns default for marker without address", () => {
    const marker = { id: "1", type: CONST.MODE.MARKER, lat: 0, lng: 0 } as MeasureData;
    expect(Export.getNameForType(marker)).toBe("Location Marker");
  });

  it("returns Distance Measurement for distance type", () => {
    expect(Export.getNameForType(distanceData)).toBe("Distance Measurement");
  });

  it("returns Area Measurement for polygon type", () => {
    expect(Export.getNameForType(polygonData)).toBe("Area Measurement");
  });

  it("returns Circle for circle type", () => {
    expect(Export.getNameForType(circleData)).toBe("Circle");
  });

  it("returns type string for unknown type", () => {
    expect(Export.getNameForType({ type: "unknown" } as MeasureData)).toBe("unknown");
  });
});

describe("Export.getBasePoint edge cases", () => {
  it("returns null for marker with null lat/lng", () => {
    const point = Export.getBasePoint({
      type: CONST.MODE.MARKER,
      lat: undefined,
      lng: undefined,
    } as MeasureData);
    expect(point).toBeNull();
  });

  it("returns null for distance with empty points array", () => {
    const point = Export.getBasePoint({
      type: CONST.MODE.DISTANCE,
      points: [],
    } as MeasureData);
    expect(point).toBeNull();
  });

  it("returns null for polygon with empty points array", () => {
    const point = Export.getBasePoint({
      type: CONST.MODE.POLYGON,
      points: [],
    } as MeasureData);
    expect(point).toBeNull();
  });
});

describe("Export.toCSV edge cases", () => {
  it("returns header only for empty array", () => {
    const csv = Export.toCSV([]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("type");
  });

  it("skips entries without type", () => {
    const csv = Export.toCSV([markerData, { id: "bad" } as MeasureData]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 valid row only
  });
});



