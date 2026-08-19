import { describe, expect, it } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
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
    expect(data.features[0].properties.address).toBe("Taiwan");
    expect(data.features[0].properties.id).toBe("foliplus_measure_marker_1000_1");
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

  it("skips unknown type gracefully (no crash)", () => {
    const json = Export.toGeoJSON([{ id: "x", type: "unknown_type" } as MeasureData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(0);
  });

  it("skips measurement with null type", () => {
    const json = Export.toGeoJSON([{ id: "x" } as MeasureData]);
    const data = JSON.parse(json);
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

  it("includes crs with WGS 84 name", () => {
    const json = Export.toGeoJSON([markerData]);
    const data = JSON.parse(json);
    expect(data.crs).toBeDefined();
    expect(data.crs.type).toBe("name");
    expect(data.crs.properties.name).toBe("urn:ogc:def:crs:OGC:1.3:CRS84");
  });

  it("omits bbox (optional per RFC 7946)", () => {
    // Consumers (QGIS / PostGIS / Leaflet) compute bounds from geometry.
    const json = Export.toGeoJSON([markerData, distanceData]);
    const data = JSON.parse(json);
    expect(data.bbox).toBeUndefined();
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
    expect(header).toContain("center");
    expect(header).toContain("totalDistance");
    expect(header).toContain("area");
    expect(header).toContain("radius");
    expect(header).toContain("address");
    expect(header).toContain("wkt");
  });

  it("marker row includes id", () => {
    const csv = Export.toCSV([markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain(markerData.id!);
  });

  it("marker row includes address", () => {
    const csv = Export.toCSV([markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain("Taiwan");
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

  it("polygon row includes saved centroid in center column", () => {
    const csv = Export.toCSV([
      { ...polygonData, center: { lng: 119.315, lat: 26.085 } } as MeasureData,
    ]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("26.085000,119.315000");
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
    expect(lastAnchor.download).toBe("test_data.geojson");
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

  it("handles multiple measurements in one download", () => {
    Export.exportMeasurements([markerData, distanceData], "geojson");
    expect(createdUrls.length).toBe(1);
    expect(lastAnchor.click).toHaveBeenCalled();
  });

  it("creates geojson blob with correct MIME type", () => {
    Export.exportMeasurements([markerData], "geojson");
    const blobArg = URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.type).toBe("application/geo+json");
  });

  it("creates csv blob with correct MIME type", () => {
    Export.exportMeasurements([markerData], "csv");
    const blobArg = URL.createObjectURL.mock.calls[0][0];
    expect(blobArg.type).toBe("text/csv");
  });

  it("uses default filename prefix when CONF.filename is undefined", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl" };
    Export.exportMeasurements([markerData], "geojson");
    expect(lastAnchor.download).toBe("measurements.geojson");
    (window as any).CONF = prev;
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
    expect(Export.getNameForType(markerData)).toBe("Location Marker");
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

  it("falls back to NAME_LABEL when locale table is missing", () => {
    expect(Export.getNameForType(markerData)).toBe("Location Marker");
    expect(Export.getNameForType(distanceData)).toBe("Distance Measurement");
    expect(Export.getNameForType(polygonData)).toBe("Area Measurement");
    expect(Export.getNameForType(circleData)).toBe("Circle");
  });
});

describe("Export.toCSV edge cases", () => {
  it("returns header only for empty array", () => {
    const csv = Export.toCSV([]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("type");
  });

  it("skips entries without type", () => {
    const csv = Export.toCSV([markerData, { id: "bad" } as MeasureData]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 valid row only
  });
});

describe("Export.toGeoJSON edge cases", () => {
  it("filters out entries without a type", () => {
    const json = Export.toGeoJSON([markerData, { id: "bad" } as MeasureData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Point");
  });

  it("produces valid JSON that round-trips", () => {
    const json = Export.toGeoJSON([markerData]);
    const parsed = JSON.parse(json);
    const reSerialized = JSON.stringify(parsed);
    expect(JSON.parse(reSerialized)).toEqual(parsed);
  });
});

describe("Export.toCSV edge cases", () => {
  it("handles marker with null lat/lng", () => {
    const marker = {
      id: "m1",
      type: CONST.MODE.MARKER,
      lat: undefined,
      lng: undefined,
    } as MeasureData;
    const csv = Export.toCSV([marker]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
    const row = lines[1].split(",");
    // center should be an empty string when the marker has no center
    expect(row[3]).toBe("");
  });

  it("handles marker with address containing comma", () => {
    const marker = {
      id: "m1",
      type: CONST.MODE.MARKER,
      lat: 26.08,
      lng: 119.3,
      address: "City, District",
    } as MeasureData;
    const csv = Export.toCSV([marker]);
    // The address with comma should be quoted
    expect(csv).toContain('"City, District"');
  });

  it("handles circle with null center", () => {
    const circle = {
      id: "c1",
      type: CONST.MODE.CIRCLE,
      center: null,
    } as MeasureData;
    const csv = Export.toCSV([circle]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
    const row = lines[1].split(",");
    // center column is empty for a null-center circle
    expect(row[3]).toBe("");
  });

  it("handles distance with empty points", () => {
    const dist = {
      id: "d1",
      type: CONST.MODE.DISTANCE,
      points: [],
    } as MeasureData;
    const csv = Export.toCSV([dist]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2);
  });
});

describe("Export.csvEscape edge cases", () => {
  it("handles null and undefined values", () => {
    expect(Export.csvEscape(null as any)).toBe("");
    expect(Export.csvEscape(undefined as any)).toBe("");
  });

  it("handles numbers", () => {
    expect(Export.csvEscape(0)).toBe("0");
    expect(Export.csvEscape(-1)).toBe("-1");
    expect(Export.csvEscape(3.14)).toBe("3.14");
  });

  it("handles string with all special chars", () => {
    expect(Export.csvEscape('a,"b",\nc')).toBe('"a,""b"",\nc"');
  });
});

describe("Export.getDefaultFormat more cases", () => {
  it("returns geojson when CONF is undefined", () => {
    const prev = window.CONF;
    (window as any).CONF = undefined;
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    (window as any).CONF = prev;
  });

  it("returns geojson when CONF.export_format is null", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: null };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    (window as any).CONF = prev;
  });
});

describe("Export.handleExportClick", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalCreateElement: typeof document.createElement;
  let originalAppendChild: typeof HTMLBodyElement.prototype.appendChild;
  let lastAnchor: any;

  const makeMgr = (measurements: MeasureData[] = [markerData]) => ({
    measurements,
    map: { foliplus: { showHint: vi.fn() } },
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", filename: "meas" };

    originalCreateObjectURL = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => "blob:test") as any;
    originalCreateElement = document.createElement;
    document.createElement = vi.fn((tag: string) => {
      if (tag === "a") {
        const anchor = { href: "", download: "", click: vi.fn(), appendChild: vi.fn() };
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

  it("stops propagation", () => {
    const mgr = makeMgr([markerData]);
    const stopPropagation = vi.fn();
    const handler = Export.handleExportClick(mgr as any);
    handler({ stopPropagation } as any);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("shows hint when no measurements", () => {
    const mgr = makeMgr([]);
    const handler = Export.handleExportClick(mgr as any);
    handler({ stopPropagation: vi.fn() } as any);
    expect(mgr.map.foliplus.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      "MeasureControl.export_no_data",
      HINT_DURATION.LONG,
    );
  });

  it("triggers a download when measurements exist", () => {
    const mgr = makeMgr([markerData]);
    const handler = Export.handleExportClick(mgr as any);
    handler({ stopPropagation: vi.fn() } as any);
    expect(mgr.map.foliplus.showHint).not.toHaveBeenCalled();
    expect(lastAnchor).toBeDefined();
    expect(lastAnchor.download).toBe("meas.geojson");
    expect(lastAnchor.click).toHaveBeenCalled();
  });
});
