import { describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as Export from "#foliplus/MeasureControl/export.js";
import * as downloadMod from "#common/download.js";

vi.mock("#common/locale.js", () => ({
  createTranslator: () => (k: string) => k,
  createScopedTranslator: () => (k: string) => k,
}));

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

describe("Export.resolveExportFormat", () => {
  it("resolves geojson", () => {
    expect(Export.resolveExportFormat("geojson")).toBe(CONST.EXPORT_FORMAT.GEOJSON);
  });

  it("resolves csv", () => {
    expect(Export.resolveExportFormat("csv")).toBe(CONST.EXPORT_FORMAT.CSV);
  });

  it("falls back to the default for an unknown format", () => {
    expect(Export.resolveExportFormat("unknown")).toBe(CONST.EXPORT_FORMAT.GEOJSON);
  });

  it("falls back to the default for null and undefined", () => {
    expect(Export.resolveExportFormat(null)).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    expect(Export.resolveExportFormat(undefined)).toBe(CONST.EXPORT_FORMAT.GEOJSON);
  });

  it("falls back to the default for a non-string", () => {
    expect(Export.resolveExportFormat(42)).toBe(CONST.EXPORT_FORMAT.GEOJSON);
    expect(Export.resolveExportFormat({})).toBe(CONST.EXPORT_FORMAT.GEOJSON);
  });
});

describe("Export.currentExportFormat", () => {
  it("returns the geojson record when CONF.export_format is missing", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl" };
    const meta = Export.currentExportFormat();
    expect(meta.ext).toBe("geojson");
    expect(meta.mime).toBe("application/geo+json");
    expect(typeof meta.serialize).toBe("function");
    (window as any).CONF = prev;
  });

  it("returns the csv record for export_format: csv", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "csv" };
    const meta = Export.currentExportFormat();
    expect(meta.ext).toBe("csv");
    expect(meta.mime).toBe("text/csv");
    (window as any).CONF = prev;
  });

  it("falls back to geojson for an unknown CONF.export_format", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "unknown" };
    expect(Export.currentExportFormat().ext).toBe("geojson");
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

  it("omits crs member (RFC 7946 — coordinates are always WGS 84)", () => {
    const json = Export.toGeoJSON([markerData]);
    const data = JSON.parse(json);
    expect(data.crs).toBeUndefined();
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
    expect(polyRow).toContain("119.315000,26.085000");
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

// ── Download stub ──

// `download()` is the module that actually triggers the anchor click — spied on
// the namespace object so `exportMeasurements` picks the mock up. Shared by the
// two suites below.
const stubDownload = () => {
  const anchors: { blob: Blob; filename: string }[] = [];
  const downloadSpy = vi
    .spyOn(downloadMod, "download")
    .mockImplementation((blob: Blob, filename: string) => {
      anchors.push({ blob, filename });
    });
  return {
    anchors,
    restore: () => downloadSpy.mockRestore(),
  };
};

describe("Export.currentExportFormat — serialize hooks", () => {
  it("geojson serialize emits a FeatureCollection", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "geojson" };
    const json = Export.currentExportFormat().serialize([markerData]);
    (window as any).CONF = prev;
    expect(JSON.parse(json).type).toBe("FeatureCollection");
  });

  it("csv serialize prefixes a BOM", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "csv" };
    const csv = Export.currentExportFormat().serialize([markerData]);
    (window as any).CONF = prev;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // The BOM must not land inside the header row.
    expect(csv.slice(1).split("\n")[0]).toContain("id,type,name");
  });

  it("csv serialize output matches toCSV apart from the BOM", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "csv" };
    const csv = Export.currentExportFormat().serialize([markerData]);
    (window as any).CONF = prev;
    expect(csv.slice(1)).toBe(Export.toCSV([markerData]));
  });

  it("serializers are pure — same input yields the same output", () => {
    const prev = window.CONF;
    const geo = Export.currentExportFormat;
    (window as any).CONF = { name: "MeasureControl", export_format: "geojson" };
    expect(geo().serialize([markerData])).toBe(geo().serialize([markerData]));
    (window as any).CONF = { name: "MeasureControl", export_format: "csv" };
    expect(geo().serialize([markerData])).toBe(geo().serialize([markerData]));
    (window as any).CONF = prev;
  });
});

describe("Export.exportMeasurements", () => {
  let dl: ReturnType<typeof stubDownload>;
  let prevConf: typeof window.CONF | undefined;

  beforeEach(() => {
    dl = stubDownload();
    prevConf = window.CONF;
    (window as any).CONF = { name: "MeasureControl", filename: "test_data" };
  });

  afterEach(() => {
    dl.restore();
    (window as any).CONF = prevConf;
  });

  it("creates a download with geojson format and correct filename", () => {
    Export.exportMeasurements([markerData], "geojson");

    expect(dl.anchors.length).toBe(1);
    expect(dl.anchors[0].filename).toBe("test_data.geojson");
    expect(dl.anchors[0].blob).toBeInstanceOf(Blob);
  });

  it("creates a download with csv format and correct filename", () => {
    Export.exportMeasurements([markerData], "csv");

    expect(dl.anchors.length).toBe(1);
    expect(dl.anchors[0].filename).toBe("test_data.csv");
  });

  it("does nothing when measurements is empty", () => {
    Export.exportMeasurements([], "geojson");
    expect(dl.anchors.length).toBe(0);
  });

  it("does nothing when measurements is null", () => {
    Export.exportMeasurements(null as any, "geojson");
    expect(dl.anchors.length).toBe(0);
  });

  it("handles multiple measurements in one download", () => {
    Export.exportMeasurements([markerData, distanceData], "geojson");
    expect(dl.anchors.length).toBe(1);
  });

  it("creates geojson blob with the table mime type", () => {
    Export.exportMeasurements([markerData], "geojson");
    expect(dl.anchors[0].blob.type).toBe("application/geo+json");
  });

  it("creates csv blob with the table mime type", () => {
    Export.exportMeasurements([markerData], "csv");
    expect(dl.anchors[0].blob.type).toBe("text/csv");
  });

  it("uses the default filename prefix when CONF.filename is missing", () => {
    (window as any).CONF = { name: "MeasureControl" };
    Export.exportMeasurements([markerData], "geojson");
    expect(dl.anchors[0].filename).toBe("measurements.geojson");
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
  it("returns the mode's display label for every built-in type", () => {
    expect(Export.getNameForType(markerData)).toBe("Location Marker");
    expect(Export.getNameForType(distanceData)).toBe("Distance Measurement");
    expect(Export.getNameForType(polygonData)).toBe("Area Measurement");
    expect(Export.getNameForType(circleData)).toBe("Circle Measurement");
  });

  it("returns the label regardless of the marker's address", () => {
    const noAddress = {
      id: "1",
      type: CONST.MODE.MARKER,
      lat: 0,
      lng: 0,
    } as MeasureData;
    expect(Export.getNameForType(noAddress)).toBe("Location Marker");
  });

  it("returns the raw type string when the mode is unknown", () => {
    expect(Export.getNameForType({ type: "unknown" } as MeasureData)).toBe("unknown");
  });
});

describe("Export.toCSV edge cases", () => {
  it("returns the header alone for an empty array", () => {
    const csv = Export.toCSV([]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("type");
  });

  it("skips entries without a type", () => {
    const csv = Export.toCSV([markerData, { id: "bad" } as MeasureData]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 valid row only
  });

  it("leaves the center column empty for a marker with no coordinates", () => {
    const marker = {
      id: "m1",
      type: CONST.MODE.MARKER,
      lat: undefined,
      lng: undefined,
    } as MeasureData;
    const row = Export.toCSV([marker]).split("\n")[1].split(",");
    expect(row[3]).toBe("");
  });

  it("quotes an address that contains a comma", () => {
    const marker = {
      id: "m1",
      type: CONST.MODE.MARKER,
      lat: 26.08,
      lng: 119.3,
      address: "City, District",
    } as MeasureData;
    expect(Export.toCSV([marker])).toContain('"City, District"');
  });

  it("leaves the center column empty for a null-center circle", () => {
    const circle = {
      id: "c1",
      type: CONST.MODE.CIRCLE,
      center: null,
    } as MeasureData;
    const row = Export.toCSV([circle]).split("\n")[1].split(",");
    expect(row[3]).toBe("");
  });

  it("emits a row even for a distance with no points", () => {
    const dist = {
      id: "d1",
      type: CONST.MODE.DISTANCE,
      points: [],
    } as MeasureData;
    expect(Export.toCSV([dist]).split("\n").length).toBe(2);
  });
});

describe("Export.toGeoJSON edge cases", () => {
  it("drops entries without a type", () => {
    const json = Export.toGeoJSON([markerData, { id: "bad" } as MeasureData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Point");
  });

  it("round-trips through JSON.parse", () => {
    const json = Export.toGeoJSON([markerData]);
    const parsed = JSON.parse(json);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
  });
});

describe("Export.csvEscape edge cases", () => {
  it("returns an empty string for null and undefined", () => {
    expect(Export.csvEscape(null as any)).toBe("");
    expect(Export.csvEscape(undefined as any)).toBe("");
  });

  it("passes numbers through as strings", () => {
    expect(Export.csvEscape(0)).toBe("0");
    expect(Export.csvEscape(-1)).toBe("-1");
    expect(Export.csvEscape(3.14)).toBe("3.14");
  });

  it("wraps a field that combines every escape trigger", () => {
    expect(Export.csvEscape('a,"b",\nc')).toBe('"a,""b"",\nc"');
  });
});

describe("Export.currentExportFormat — CONF edge cases", () => {
  it("falls back to geojson for null and undefined CONF.export_format", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: null };
    expect(Export.currentExportFormat().ext).toBe("geojson");
    (window as any).CONF = { name: "MeasureControl" };
    expect(Export.currentExportFormat().ext).toBe("geojson");
    (window as any).CONF = prev;
  });
});

describe("Export.handleExportClick", () => {
  let dl: ReturnType<typeof stubDownload>;
  let prevConf: typeof window.CONF | undefined;

  const makeMgr = (measurements: MeasureData[] = [markerData]) => ({
    store: { all: () => measurements },
    map: { foliplus: { showHint: vi.fn() } },
  });

  beforeEach(() => {
    dl = stubDownload();
    prevConf = window.CONF;
    (window as any).CONF = { name: "MeasureControl", filename: "meas" };
  });

  afterEach(() => {
    dl.restore();
    (window as any).CONF = prevConf;
  });

  it("stops propagation", () => {
    const stopPropagation = vi.fn();
    Export.handleExportClick(makeMgr() as any)({ stopPropagation } as any);
    expect(stopPropagation).toHaveBeenCalled();
  });

  it("shows a hint instead of downloading when there is nothing to export", () => {
    const mgr = makeMgr([]);
    Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any);
    expect(mgr.map.foliplus.showHint).toHaveBeenCalledWith(
      "MeasureControl",
      "export_no_data",
      HINT_DURATION.LONG,
    );
    expect(dl.anchors.length).toBe(0);
  });

  it("triggers a download and shows no hint when measurements exist", () => {
    const mgr = makeMgr([markerData]);
    Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any);
    expect(mgr.map.foliplus.showHint).not.toHaveBeenCalled();
    expect(dl.anchors.length).toBe(1);
    expect(dl.anchors[0].filename).toBe("meas.geojson");
  });


  it("shows a success hint after the download completes", () => {
    const mgr = makeMgr([markerData]);
    Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any);
    const [component, text, duration] = mgr.map.foliplus.showHint.mock.calls[0];
    expect(component).toBe("MeasureControl");
    expect(duration).toBe(HINT_DURATION.LONG);
    // The success text is two key concatenations — T() is the identity
    // function under the locale mock, so the keys are adjacent.
    expect(text).toBe("export_successexport_file");
    // No success is claimed without a file being written.
    expect(dl.anchors.length).toBe(1);
  });

  it("shows a failure hint when serialization throws", () => {
    // JSON.stringify is the narrowest seam that puts a throw inside the
    // handler's try block — download() is called there too, but making it
    // throw is a real DOM failure rather than a controlled condition.
    const stringify = JSON.stringify;
    JSON.stringify = (() => {
      throw new Error("boom");
    }) as any;
    try {
      const mgr = makeMgr([markerData]);
      Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any);
      const [component, text, duration] = mgr.map.foliplus.showHint.mock.calls[0];
      expect(component).toBe("MeasureControl");
      expect(text).toBe("export_failerr_export");
      expect(duration).toBe(HINT_DURATION.LONG);
      expect(dl.anchors.length).toBe(0);
    } finally {
      JSON.stringify = stringify;
    }
  });

  it("resolves the format from CONF, defaulting to geojson", () => {
    Export.handleExportClick(makeMgr() as any)({ stopPropagation: vi.fn() } as any);
    expect(dl.anchors[0].filename).toBe("meas.geojson");

    (window as any).CONF = {
      name: "MeasureControl",
      filename: "meas",
      export_format: "csv",
    };
    Export.handleExportClick(makeMgr() as any)({ stopPropagation: vi.fn() } as any);
    expect(dl.anchors[1].filename).toBe("meas.csv");
  });

  it("warns instead of throwing when the export fails", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(downloadMod, "download").mockImplementation(() => {
      throw new Error("boom");
    });
    const mgr = makeMgr([{ id: "x" } as MeasureData]);
    expect(() =>
      Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any),
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("export failed");
  });
});

describe("Export.toWKT — unknown type", () => {
  it("wkt column is empty when the type has no mode", () => {
    const csv = Export.toCSV([{ id: "x", type: "unknown" } as MeasureData]);
    const row = csv.split("\n")[1].split(",");
    expect(row[8]).toBe("");
  });
});
