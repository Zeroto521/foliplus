import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromWgs84, getMapCrsType, toWgs84 } from "#core/geo/index.js";

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

  it("returns GCJ02 from crs.code when no tile URL matches", () => {
    const map = {
      options: { crs: { code: "EPSG:3857 GCJ02" } },
      _layers: { 1: { _url: "https://tile.openstreetmap.org" } },
    };
    expect(getMapCrsType(map)).toBe("GCJ02");
  });

  it("tolerates tile layers without a URL", () => {
    const map = {
      options: { crs: { code: "EPSG:3857" } },
      _layers: { 1: {} },
    };
    expect(getMapCrsType(map)).toBe("WGS84");
  });

  it("returns WGS84 for foreign map", () => {
    expect(getMapCrsType(foreignMap)).toBe("WGS84");
  });

  it("returns WGS84 on error (null map)", () => {
    expect(getMapCrsType(null)).toBe("WGS84");
  });
});

describe("CRS probe error reporting", () => {
  // A map whose crs.code throws on read — forces the code-path probe failure.
  const throwingCodeMap = () => ({
    options: {
      crs: {
        get code() {
          throw new Error("proxy");
        },
      },
    },
    _layers: foreignMap._layers,
  });

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("warns when the L.CRS check throws", () => {
    vi.stubGlobal("L", {
      get CRS() {
        throw new Error("no plugin");
      },
    });
    expect(getMapCrsType(foreignMap)).toBe("WGS84");
    expect(console.warn).toHaveBeenCalledWith(
      "[foliplus] L.CRS unavailable (Baidu CRS check skipped):",
      expect.any(Error),
    );
  });

  it("warns when crs.code is an unreadable property", () => {
    expect(getMapCrsType(throwingCodeMap())).toBe("WGS84");
    expect(console.warn).toHaveBeenCalledWith(
      "[foliplus] map CRS code unreadable (CRS fallback to WGS84):",
      expect.any(Error),
    );
  });

  it("warns when tile layer traversal throws", () => {
    const map = {
      options: { crs: { code: "EPSG:3857" } },
      get _layers() {
        throw new Error("layer registry gone");
      },
    };
    expect(getMapCrsType(map)).toBe("WGS84");
    expect(console.warn).toHaveBeenCalledWith(
      "[foliplus] tile layer URL traversal failed (CRS fallback to WGS84):",
      expect.any(Error),
    );
  });

  it("stays silent on a healthy map", () => {
    expect(getMapCrsType(foreignMap)).toBe("WGS84");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns at most once per call site when one probe fails", () => {
    // probeMap reads each fact once, so one failing read must not multiply into
    // repeated noise — getMapCrsType asks three questions per call.
    getMapCrsType(throwingCodeMap());
    const messages = console.warn.mock.calls.map(call => call[0]);
    expect(messages).toEqual([
      "[foliplus] map CRS code unreadable (CRS fallback to WGS84):",
    ]);
  });

  it("warns once per failing probe when two distinct probes fail", () => {
    const map = {
      options: {
        crs: {
          get code() {
            throw new Error("crs");
          },
        },
      },
      get _layers() {
        throw new Error("layers");
      },
    };
    expect(getMapCrsType(map)).toBe("WGS84");
    const messages = console.warn.mock.calls.map(call => call[0]);
    // Order follows probeMap: _layers is read first, crs.code second.
    expect(messages).toEqual([
      "[foliplus] tile layer URL traversal failed (CRS fallback to WGS84):",
      "[foliplus] map CRS code unreadable (CRS fallback to WGS84):",
    ]);
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

  it("returns coords unchanged and warns when gcoord is missing (fromWgs84)", () => {
    delete globalThis.gcoord;
    const result = fromWgs84(foreignMap, 120, 30);
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
