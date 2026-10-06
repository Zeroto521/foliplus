import { describe, expect, it, vi } from "vitest";
import { HINT_DURATION } from "#core/hint.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as Export from "#foliplus/MeasureControl/export.js";
import { MarkerMode } from "#foliplus/MeasureControl/mode/index.js";
import * as downloadMod from "#common/download.js";
import { makeControlEnv } from "../fixture.js";

// This file asserts on bare locale-key strings (identity T/_): the export
// hint text is built by key concatenation, so scoped lookups would wrap the
// keys and break the expectations. Pin translators explicitly.
const identity = { T: (k: string) => k, _: (k: string) => k };

vi.mock("#common/locale.js", () => ({
  createTranslator: () => (k: string) => k,
  createScopedTranslator: () => (k: string) => k,
}));

window.CONFIG = { ...window.CONFIG, name: "MeasureControl", locale_code: "en" };

const env = makeControlEnv(window.CONFIG, identity);

// ── Test data fixtures ──

const markerData: MeasureData = {
  id: "foliplus_measure_marker_1000_1",
  type: CONST.MEASURE_MODE.MARKER,
  lng: 119.3,
  lat: 26.08,
  address: "Taiwan",
};

const distanceData: MeasureData = {
  id: "foliplus_measure_distance_1000_2",
  type: CONST.MEASURE_MODE.DISTANCE,
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
  type: CONST.MEASURE_MODE.POLYGON,
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
  type: CONST.MEASURE_MODE.CIRCLE,
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
  it("returns the geojson record when CONFIG.export_format is missing", () => {
    const prev = window.CONFIG.export_format;
    delete window.CONFIG.export_format;
    const meta = Export.currentExportFormat(env);
    expect(meta.ext).toBe("geojson");
    expect(meta.mime).toBe("application/geo+json");
    expect(typeof meta.serialize).toBe("function");
    if (prev !== undefined) window.CONFIG.export_format = prev;
  });

  it("returns the csv record for export_format: csv", () => {
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = "csv";
    const meta = Export.currentExportFormat(env);
    expect(meta.ext).toBe("csv");
    expect(meta.mime).toBe("text/csv");
    if (prev !== undefined) window.CONFIG.export_format = prev;
  });

  it("falls back to geojson for an unknown CONFIG.export_format", () => {
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = "unknown";
    expect(Export.currentExportFormat(env).ext).toBe("geojson");
    if (prev !== undefined) window.CONFIG.export_format = prev;
  });
});

describe("Export.toGeoJSON", () => {
  it("converts marker to Point feature", () => {
    const json = Export.toGeoJSON(env, [markerData]);
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
    const json = Export.toGeoJSON(env, [distanceData]);
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
    const json = Export.toGeoJSON(env, [polygonData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Polygon");
    const coords = data.features[0].geometry.coordinates[0];
    expect(coords.length).toBe(5); // 4 points + closed back to first
    expect(coords[0]).toEqual(coords[4]); // first == last
    expect(data.features[0].properties.area).toBe(3300000);
  });

  it("converts circle to Polygon feature with 8 points", () => {
    const json = Export.toGeoJSON(env, [circleData]);
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
    const json = Export.toGeoJSON(env, []);
    const data = JSON.parse(json);
    expect(data.type).toBe("FeatureCollection");
    expect(data.features.length).toBe(0);
  });

  it("skips unknown type gracefully (no crash)", () => {
    const json = Export.toGeoJSON(env, [
      { id: "x", type: "unknown_type" } as MeasureData,
    ]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(0);
  });

  it("skips measurement with null type", () => {
    const json = Export.toGeoJSON(env, [{ id: "x" } as MeasureData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(0);
  });

  it("handles multiple measurement types", () => {
    const json = Export.toGeoJSON(env, [
      markerData,
      distanceData,
      polygonData,
      circleData,
    ]);
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
    const json = Export.toGeoJSON(env, [markerData]);
    const data = JSON.parse(json);
    expect(data.crs).toBeUndefined();
  });

  it("omits bbox (optional per RFC 7946)", () => {
    // Consumers (QGIS / PostGIS / Leaflet) compute bounds from geometry.
    const json = Export.toGeoJSON(env, [markerData, distanceData]);
    const data = JSON.parse(json);
    expect(data.bbox).toBeUndefined();
  });
});

describe("Export.toCSV", () => {
  it("produces CSV with header and rows", () => {
    const csv = Export.toCSV(env, [markerData, distanceData]);
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
    const csv = Export.toCSV(env, [markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain(markerData.id!);
  });

  it("marker row includes address", () => {
    const csv = Export.toCSV(env, [markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain("Taiwan");
  });

  it("distance row includes totalDistance", () => {
    const csv = Export.toCSV(env, [distanceData]);
    const lines = csv.split("\n");
    const distRow = lines[1];
    expect(distRow).toContain("3700");
  });

  it("polygon row includes area", () => {
    const csv = Export.toCSV(env, [polygonData]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("3300000");
  });

  it("circle row includes radius", () => {
    const csv = Export.toCSV(env, [circleData]);
    const lines = csv.split("\n");
    const circleRow = lines[1];
    expect(circleRow).toContain("5000");
  });

  it("polygon row includes saved centroid in center column", () => {
    const csv = Export.toCSV(env, [
      { ...polygonData, center: { lng: 119.315, lat: 26.085 } } as MeasureData,
    ]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("119.315000,26.085000");
  });

  it("wkt column contains WKT geometry", () => {
    const csv = Export.toCSV(env, [distanceData]);
    const lines = csv.split("\n");
    const distRow = lines[1];
    expect(distRow).toContain("LINESTRING(119.3");
  });

  it("wkt polygon is a closed ring", () => {
    const csv = Export.toCSV(env, [polygonData]);
    const lines = csv.split("\n");
    const polyRow = lines[1];
    expect(polyRow).toContain("POLYGON((119.3");
  });

  it("wkt marker is a POINT", () => {
    const csv = Export.toCSV(env, [markerData]);
    const lines = csv.split("\n");
    const markerRow = lines[1];
    expect(markerRow).toContain("POINT(119.3");
  });

  it('csvEscape fallback handles undefined row values via ?? ""', () => {
    // Defensive: if getNameForType ever returns undefined (e.g. unrecognised
    // type), the ?? "" on the csvEscape line prevents csvEscape from receiving
    // a non-string argument.
    const spy = vi.spyOn(Export, "getNameForType").mockReturnValue(undefined);
    try {
      const csv = Export.toCSV(env, [markerData]);
      const lines = csv.split("\n");
      const markerRow = lines[1];
      // The name column (index 2) should be empty, not "undefined"
      expect(markerRow).not.toContain("undefined");
    } finally {
      spy.mockRestore();
    }
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
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = "geojson";
    const json = Export.currentExportFormat(env).serialize(env, [markerData]);
    if (prev !== undefined) window.CONFIG.export_format = prev;
    expect(JSON.parse(json).type).toBe("FeatureCollection");
  });

  it("csv serialize prefixes a BOM", () => {
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = "csv";
    const csv = Export.currentExportFormat(env).serialize(env, [markerData]);
    if (prev !== undefined) window.CONFIG.export_format = prev;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    // The BOM must not land inside the header row.
    expect(csv.slice(1).split("\n")[0]).toContain("id,type,name");
  });

  it("csv serialize output matches toCSV apart from the BOM", () => {
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = "csv";
    const csv = Export.currentExportFormat(env).serialize(env, [markerData]);
    if (prev !== undefined) window.CONFIG.export_format = prev;
    expect(csv.slice(1)).toBe(Export.toCSV(env, [markerData]));
  });

  it("serializers are pure — same input yields the same output", () => {
    const prev = window.CONFIG.export_format;
    const geo = Export.currentExportFormat;
    window.CONFIG.export_format = "geojson";
    expect(geo(env).serialize(env, [markerData])).toBe(
      geo(env).serialize(env, [markerData]),
    );
    window.CONFIG.export_format = "csv";
    expect(geo(env).serialize(env, [markerData])).toBe(
      geo(env).serialize(env, [markerData]),
    );
    if (prev !== undefined) window.CONFIG.export_format = prev;
  });
});

describe("Export.exportMeasurements", () => {
  let dl: ReturnType<typeof stubDownload>;

  beforeEach(() => {
    dl = stubDownload();
    delete window.CONFIG.filename;
    window.CONFIG.filename = "test_data";
  });

  afterEach(() => {
    dl.restore();
    delete window.CONFIG.filename;
  });

  it("creates a download with geojson format and correct filename", () => {
    Export.exportMeasurements(env, [markerData], "geojson");

    expect(dl.anchors.length).toBe(1);
    expect(dl.anchors[0].filename).toBe("test_data.geojson");
    expect(dl.anchors[0].blob).toBeInstanceOf(Blob);
  });

  it("creates a download with csv format and correct filename", () => {
    Export.exportMeasurements(env, [markerData], "csv");

    expect(dl.anchors.length).toBe(1);
    expect(dl.anchors[0].filename).toBe("test_data.csv");
  });

  it("does nothing when measurements is empty", () => {
    Export.exportMeasurements(env, [], "geojson");
    expect(dl.anchors.length).toBe(0);
  });

  it("does nothing when measurements is null", () => {
    Export.exportMeasurements(env, null as any, "geojson");
    expect(dl.anchors.length).toBe(0);
  });

  it("handles multiple measurements in one download", () => {
    Export.exportMeasurements(env, [markerData, distanceData], "geojson");
    expect(dl.anchors.length).toBe(1);
  });

  it("creates geojson blob with the table mime type", () => {
    Export.exportMeasurements(env, [markerData], "geojson");
    expect(dl.anchors[0].blob.type).toBe("application/geo+json");
  });

  it("creates csv blob with the table mime type", () => {
    Export.exportMeasurements(env, [markerData], "csv");
    expect(dl.anchors[0].blob.type).toBe("text/csv");
  });

  it("uses the default filename prefix when CONFIG.filename is missing", () => {
    delete window.CONFIG.filename;
    Export.exportMeasurements(env, [markerData], "geojson");
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
    expect(Export.getNameForType(env, markerData)).toBe("Location Marker");
    expect(Export.getNameForType(env, distanceData)).toBe("Distance Measurement");
    expect(Export.getNameForType(env, polygonData)).toBe("Area Measurement");
    expect(Export.getNameForType(env, circleData)).toBe("Circle Measurement");
  });

  it("returns the label regardless of the marker's address", () => {
    const noAddress = {
      id: "1",
      type: CONST.MEASURE_MODE.MARKER,
      lat: 0,
      lng: 0,
    } as MeasureData;
    expect(Export.getNameForType(env, noAddress)).toBe("Location Marker");
  });

  it("returns the raw type string when the mode is unknown", () => {
    expect(Export.getNameForType(env, { type: "unknown" } as MeasureData)).toBe(
      "unknown",
    );
  });
});

describe("Export.toCSV edge cases", () => {
  it("returns the header alone for an empty array", () => {
    const csv = Export.toCSV(env, []);
    const lines = csv.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("type");
  });

  it("skips entries without a type", () => {
    const csv = Export.toCSV(env, [markerData, { id: "bad" } as MeasureData]);
    const lines = csv.split("\n");
    expect(lines.length).toBe(2); // header + 1 valid row only
  });

  it("leaves the center column empty for a marker with no coordinates", () => {
    const marker = {
      id: "m1",
      type: CONST.MEASURE_MODE.MARKER,
      lat: undefined,
      lng: undefined,
    } as MeasureData;
    const row = Export.toCSV(env, [marker]).split("\n")[1].split(",");
    expect(row[3]).toBe("");
  });

  it("quotes an address that contains a comma", () => {
    const marker = {
      id: "m1",
      type: CONST.MEASURE_MODE.MARKER,
      lat: 26.08,
      lng: 119.3,
      address: "City, District",
    } as MeasureData;
    expect(Export.toCSV(env, [marker])).toContain('"City, District"');
  });

  it("leaves the center column empty for a null-center circle", () => {
    const circle = {
      id: "c1",
      type: CONST.MEASURE_MODE.CIRCLE,
      center: null,
    } as MeasureData;
    const row = Export.toCSV(env, [circle]).split("\n")[1].split(",");
    expect(row[3]).toBe("");
  });

  it("emits a row even for a distance with no points", () => {
    const dist = {
      id: "d1",
      type: CONST.MEASURE_MODE.DISTANCE,
      points: [],
    } as MeasureData;
    expect(Export.toCSV(env, [dist]).split("\n").length).toBe(2);
  });
});

describe("Export.toGeoJSON edge cases", () => {
  it("drops entries without a type", () => {
    const json = Export.toGeoJSON(env, [markerData, { id: "bad" } as MeasureData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Point");
  });

  it("round-trips through JSON.parse", () => {
    const json = Export.toGeoJSON(env, [markerData]);
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

describe("Export.currentExportFormat — CONFIG edge cases", () => {
  it("falls back to geojson for null and undefined CONFIG.export_format", () => {
    const prev = window.CONFIG.export_format;
    window.CONFIG.export_format = null as any;
    expect(Export.currentExportFormat(env).ext).toBe("geojson");
    window.CONFIG.export_format = undefined;
    expect(Export.currentExportFormat(env).ext).toBe("geojson");
    if (prev !== undefined) window.CONFIG.export_format = prev;
  });
});

describe("Export.handleExportClick", () => {
  let dl: ReturnType<typeof stubDownload>;

  const makeMgr = (measurements: MeasureData[] = [markerData]) => {
    // handleExportClick reads mgr.env for the env-typed export functions and
    // mgr.config/T/log for the hint path — the mock mirrors the real manager.
    const env = makeControlEnv(window.CONFIG, identity);
    return {
      store: { all: () => measurements },
      map: { foliplus: { showHint: vi.fn() } },
      config: window.CONFIG,
      T: env.T,
      _: env._,
      log: env.log,
      env,
    };
  };

  beforeEach(() => {
    dl = stubDownload();
    delete window.CONFIG.filename;
    window.CONFIG.filename = "meas";
    delete window.CONFIG.export_format;
  });

  afterEach(() => {
    dl.restore();
    delete window.CONFIG.filename;
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
    const stringify = vi.spyOn(JSON, "stringify").mockImplementation(() => {
      throw new Error("boom");
    });
    try {
      const mgr = makeMgr([markerData]);
      Export.handleExportClick(mgr as any)({ stopPropagation: vi.fn() } as any);
      const [component, text, duration] = mgr.map.foliplus.showHint.mock.calls[0];
      expect(component).toBe("MeasureControl");
      expect(text).toBe("export_failerr_export");
      expect(duration).toBe(HINT_DURATION.LONG);
      expect(dl.anchors.length).toBe(0);
    } finally {
      stringify.mockRestore();
    }
  });

  it("resolves the format from CONFIG, defaulting to geojson", () => {
    Export.handleExportClick(makeMgr() as any)({ stopPropagation: vi.fn() } as any);
    expect(dl.anchors[0].filename).toBe("meas.geojson");

    window.CONFIG.export_format = "csv";
    Export.handleExportClick(makeMgr() as any)({ stopPropagation: vi.fn() } as any);
    expect(dl.anchors[1].filename).toBe("meas.csv");
    delete window.CONFIG.export_format;
  });

  it("falls back to the default filename when CONFIG.filename is missing", () => {
    delete window.CONFIG.filename;
    Export.handleExportClick(makeMgr() as any)({ stopPropagation: vi.fn() } as any);
    expect(dl.anchors[0].filename).toBe("measurements.geojson");
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
    const csv = Export.toCSV(env, [{ id: "x", type: "unknown" } as MeasureData]);
    const row = csv.split("\n")[1].split(",");
    expect(row[8]).toBe("");
  });

  it("wkt column is empty when the mode returns an unrecognized geometry", () => {
    // featureToWKT's switch handles only Point/LineString/Polygon — the
    // three geometry types the built-in modes emit. Anything else hits the
    // default branch and returns an empty string.
    const spy = vi.spyOn(MarkerMode, "toGeoFeature").mockReturnValue({
      type: "Feature",
      geometry: { type: "MultiPoint", coordinates: [[119.3, 26.08]] },
      properties: {},
    } as GeoJSON.Feature);
    try {
      // No address/center so csvEscape quotes no field and row[8] is unambiguously wkt.
      const csv = Export.toCSV(env, [
        { id: "x", type: CONST.MEASURE_MODE.MARKER } as MeasureData,
      ]);
      const row = csv.split("\n")[1].split(",");
      expect(row[8]).toBe("");
    } finally {
      spy.mockRestore();
    }
  });

  it("id column is empty when data.id is undefined", () => {
    const csv = Export.toCSV(env, [{ type: CONST.MEASURE_MODE.MARKER } as MeasureData]);
    const row = csv.split("\n")[1].split(",");
    expect(row[0]).toBe("");
  });

  it("address column is empty when data.address is undefined", () => {
    const csv = Export.toCSV(env, [
      { id: "x", type: CONST.MEASURE_MODE.MARKER } as MeasureData,
    ]);
    const row = csv.split("\n")[1].split(",");
    expect(row[7]).toBe("");
  });

  it("wkt column is empty when geometry is null", () => {
    const spy = vi.spyOn(MarkerMode, "toGeoFeature").mockReturnValue({
      type: "Feature",
      geometry: null,
      properties: {},
    } as GeoJSON.Feature);
    try {
      const csv = Export.toCSV(env, [
        { id: "x", type: CONST.MEASURE_MODE.MARKER } as MeasureData,
      ]);
      const row = csv.split("\n")[1].split(",");
      expect(row[8]).toBe("");
    } finally {
      spy.mockRestore();
    }
  });
});
