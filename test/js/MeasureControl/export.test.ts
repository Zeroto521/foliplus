import { describe, expect, it } from "vitest";
import type { MeasureData } from "#type/global.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import * as Export from "#foliplus/MeasureControl/export.js";

// ── Test data fixtures ──

const markerData: MeasureData = {
  id: "foliplus_measure_marker_1000_1",
  type: CONST.MODE.MARKER,
  lng: 119.30,
  lat: 26.08,
  address: "Taiwan",
};

const distanceData: MeasureData = {
  id: "foliplus_measure_distance_1000_2",
  type: CONST.MODE.DISTANCE,
  points: [
    { lng: 119.30, lat: 26.08 },
    { lng: 119.31, lat: 26.09 },
    { lng: 119.32, lat: 26.10 },
  ],
  segments: [
    { lng: 119.31, lat: 26.09, distance: 1500 },
    { lng: 119.32, lat: 26.10, distance: 2200 },
  ],
  totalDistance: 3700,
};

const polygonData: MeasureData = {
  id: "foliplus_measure_polygon_1000_3",
  type: CONST.MODE.POLYGON,
  points: [
    { lng: 119.30, lat: 26.08 },
    { lng: 119.32, lat: 26.08 },
    { lng: 119.32, lat: 26.10 },
    { lng: 119.30, lat: 26.10 },
  ],
  segments: [
    { lng: 119.32, lat: 26.08, distance: 1500 },
    { lng: 119.32, lat: 26.10, distance: 2200 },
    { lng: 119.30, lat: 26.10, distance: 1500 },
  ],
  area: 3300000,
};

const circleData: MeasureData = {
  id: "foliplus_measure_circle_1000_4",
  type: CONST.MODE.CIRCLE,
  center: { lng: 119.30, lat: 26.08 },
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
  it("defines KML format", () => {
    expect(CONST.EXPORT_FORMAT.KML).toBe("kml");
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

  it("returns kml from CONF", () => {
    const prev = window.CONF;
    (window as any).CONF = { name: "MeasureControl", export_format: "kml" };
    expect(Export.getDefaultFormat()).toBe(CONST.EXPORT_FORMAT.KML);
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
    expect(data.features[0].geometry.coordinates).toEqual([119.30, 26.08]);
    expect(data.features[0].properties.type).toBe("marker");
    expect(data.features[0].properties.name).toBe("Taiwan");
  });

  it("converts distance to LineString feature", () => {
    const json = Export.toGeoJSON([distanceData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("LineString");
    expect(data.features[0].geometry.coordinates).toEqual([
      [119.30, 26.08],
      [119.31, 26.09],
      [119.32, 26.10],
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

  it("converts circle to Polygon feature with 64 points", () => {
    const json = Export.toGeoJSON([circleData]);
    const data = JSON.parse(json);
    expect(data.features.length).toBe(1);
    expect(data.features[0].geometry.type).toBe("Polygon");
    const coords = data.features[0].geometry.coordinates[0];
    // 64 circle points + 1 closed = 65 coordinates
    expect(coords.length).toBe(65);
    expect(coords[0]).toEqual(coords[64]); // closed
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
    expect(header).toContain("coordinates");
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

  it("coordinates column contains semicolon-separated point lists", () => {
    const csv = Export.toCSV([distanceData]);
    const lines = csv.split("\n");
    const distRow = lines[1];
    // coordinates column is last
    const cols = distRow.split(",");
    const coords = cols[cols.length - 1];
    expect(coords).toContain(";");
    expect(coords).toContain("119.30,26.08");
  });
});

describe("Export.toKML", () => {
  it("produces valid KML with placemarks", () => {
    const kml = Export.toKML([markerData, distanceData]);
    expect(kml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(kml).toContain("<kml xmlns="http://www.opengis.net/kml/2.2">");
    expect(kml).toContain("<Document>");
    expect(kml).toContain("</Document>");
    expect(kml).toContain("<Placemark>");
  });

  it("marker produces Point placemark", () => {
    const kml = Export.toKML([markerData]);
    expect(kml).toContain("<Point>");
    expect(kml).toContain("<coordinates>119.30 26.08</coordinates>");
  });

  it("distance produces LineString placemark", () => {
    const kml = Export.toKML([distanceData]);
    expect(kml).toContain("<LineString>");
    expect(kml).toContain("<coordinates>");
    expect(kml).toContain("119.30 26.08");
    expect(kml).toContain("119.31 26.09");
    expect(kml).toContain("119.32 26.10");
  });

  it("polygon produces closed Polygon placemark", () => {
    const kml = Export.toKML([polygonData]);
    expect(kml).toContain("<Polygon>");
    expect(kml).toContain("<LinearRing>");
    const ring = kml.match(/<coordinates>(.*?)<\/coordinates>/g);
    expect(ring).not.toBeNull();
    const coords = ring[0]
      .replace("<coordinates>", "")
      .replace("</coordinates>", "")
      .split(" ");
    expect(coords.length).toBe(5); // 4 points + closing
    expect(coords[0]).toBe(coords[4]); // closed
  });

  it("circle produces Polygon placemark with 64 points", () => {
    const kml = Export.toKML([circleData]);
    expect(kml).toContain("<Polygon>");
    const ring = kml.match(/<coordinates>(.*?)<\/coordinates>/g);
    expect(ring).not.toBeNull();
    const coords = ring[0]
      .replace("<coordinates>", "")
      .replace("</coordinates>", "")
      .split(" ");
    expect(coords.length).toBe(65); // 64 + 1 closed
  });

  it("KML name uses measurement type", () => {
    const kml = Export.toKML([markerData]);
    expect(kml).toContain("<name>Taiwan</name>");

    const kml2 = Export.toKML([distanceData]);
    expect(kml2).toContain("<name>Distance Measurement</name>");

    const kml3 = Export.toKML([polygonData]);
    expect(kml3).toContain("<name>Area Measurement</name>");

    const kml4 = Export.toKML([circleData]);
    expect(kml4).toContain("<name>Circle</name>");
  });

  it("KML includes distance/area/radius in description", () => {
    const kml = Export.toKML([distanceData, polygonData, circleData]);
    expect(kml).toContain("3700 m");
    expect(kml).toContain("3300000");
    expect(kml).toContain("5000 m");
  });
});
