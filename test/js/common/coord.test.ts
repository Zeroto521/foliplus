import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromWgs84, getMapCrsType, toWgs84 } from "#common/coord.js";

const baiduMap = {
  options: { crs: { code: "epsg:900913 baidu" } },
  _layers: {},
};
const domesticMap = {
  options: { crs: { code: "EPSG:3857" } },
  _layers: { 1: { _url: "https://webrd01.autonavi.com/tile" } },
};
const foreignMap = {
  options: { crs: { code: "EPSG:3857" } },
  _layers: { 1: { _url: "https://tile.openstreetmap.org" } },
};

describe("getMapCrsType", () => {
  it("returns BD09 for baidu", () => {
    expect(getMapCrsType(baiduMap)).toBe("BD09");
  });

  it("returns BD09 when L.CRS.Baidu is set", () => {
    window.L.CRS = { Baidu: Symbol("baidu") };
    const map = { options: { crs: window.L.CRS.Baidu }, _layers: {} };
    expect(getMapCrsType(map)).toBe("BD09");
  });

  it("returns BD09 for baidu tile URL pattern", () => {
    const map = {
      options: { crs: { code: "EPSG:3857" } },
      _layers: { 1: { _url: "https://online1.bdimg.com/tile" } },
    };
    expect(getMapCrsType(map)).toBe("BD09");
  });

  it("returns GCJ02 for domestic map", () => {
    expect(getMapCrsType(domesticMap)).toBe("GCJ02");
  });

  it("returns GCJ02 for tianditu/amap/gtimg/googleapis upstream", () => {
    for (const url of [
      "https://t0.tianditu.com/DataServer",
      "https://wprd01.amap.com/tile",
      "https://p2.map.gtimg.com/tile",
      "https://maps.googleapis.com/vt",
    ]) {
      const map = {
        options: { crs: { code: "EPSG:3857" } },
        _layers: { 1: { _url: url } },
      };
      expect(getMapCrsType(map)).toBe("GCJ02");
    }
  });

  it("returns WGS84 for foreign map", () => {
    expect(getMapCrsType(foreignMap)).toBe("WGS84");
  });

  it("returns WGS84 on error (null map)", () => {
    expect(getMapCrsType(null)).toBe("WGS84");
  });
});

describe("ensureGcoord (via toWgs84)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns coords unchanged and warns when gcoord is missing", () => {
    delete globalThis.gcoord;
    const result = toWgs84(foreignMap, 120, 30);
    expect(result).toEqual([120, 30]);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("gcoord"));
  });

  it("does not warn when gcoord is available", () => {
    globalThis.gcoord = { BD09: 0, GCJ02: 1, WGS84: 2, transform: vi.fn() };
    toWgs84(foreignMap, 120, 30);
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("toWgs84 / fromWgs84", () => {
  const transform = vi.fn(([lng, lat], _from, _to) => [lng + 1, lat + 1]);

  beforeEach(() => {
    globalThis.gcoord = { BD09: 0, GCJ02: 1, WGS84: 2, transform };
    transform.mockClear();
  });

  describe("toWgs84", () => {
    it("transforms BD09 to WGS84", () => {
      const result = toWgs84(baiduMap, 120, 30);
      expect(transform).toHaveBeenCalledWith([120, 30], 0, 2);
      expect(result).toEqual([121, 31]);
    });

    it("transforms GCJ02 to WGS84", () => {
      const result = toWgs84(domesticMap, 120, 30);
      expect(transform).toHaveBeenCalledWith([120, 30], 1, 2);
    });

    it("skips transform for WGS84 maps", () => {
      const result = toWgs84(foreignMap, 120, 30);
      expect(transform).not.toHaveBeenCalled();
      expect(result).toEqual([120, 30]);
    });
  });

  describe("fromWgs84", () => {
    it("transforms WGS84 to BD09", () => {
      const result = fromWgs84(baiduMap, 120, 30);
      expect(transform).toHaveBeenCalledWith([120, 30], 2, 0);
      expect(result).toEqual([121, 31]);
    });

    it("transforms WGS84 to GCJ02", () => {
      const result = fromWgs84(domesticMap, 120, 30);
      expect(transform).toHaveBeenCalledWith([120, 30], 2, 1);
    });

    it("skips transform for WGS84 maps", () => {
      const result = fromWgs84(foreignMap, 120, 30);
      expect(transform).not.toHaveBeenCalled();
      expect(result).toEqual([120, 30]);
    });
  });
});
