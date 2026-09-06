import { afterEach, describe, expect, it } from "vitest";
import * as CONST from "#foliplus/ExportControl/const.js";

// ===========================================================================
// Static exported constants (value-only tests, no mocking needed).
// ===========================================================================
describe("STORAGE", () => {
  it("derives key from map container id", () => {
    expect(CONST.STORAGE.KEY).toContain("foliplus_export_rect_");

    expect(CONST.STORAGE.KEY).toContain("test");
  });
});

describe("CROP", () => {
  it("defines crop constraints", () => {
    expect(CONST.CROP.MIN_SIZE).toBe(40);

    expect(CONST.CROP.PADDING_RATIO).toBe(0.25);

    expect(CONST.CROP.CONTAINER_PADDING).toBe(200);
  });
});

describe("TIMING", () => {
  it("defines timing constants", () => {
    expect(CONST.TIMING.RESTORE_DELAY).toBeGreaterThan(0);
  });
});

describe("FORMAT", () => {
  it("has one record per exportable format", () => {
    expect(Object.keys(CONST.FORMAT).sort()).toEqual([
      "geotiff",
      "jpeg",
      "png",
      "webp",
    ]);
  });

  it("maps format to mime type, extension, and pipeline flags", () => {
    expect(CONST.FORMAT.png).toEqual({
      mime: "image/png",
      ext: "png",
      lossy: false,
      geotiff: false,
    });

    expect(CONST.FORMAT.jpeg).toEqual({
      mime: "image/jpeg",
      ext: "jpeg",
      lossy: true,
      geotiff: false,
    });

    expect(CONST.FORMAT.webp).toEqual({
      mime: "image/webp",
      ext: "webp",
      lossy: true,
      geotiff: false,
    });

    expect(CONST.FORMAT.geotiff).toEqual({
      mime: "image/tiff",
      ext: "tif",
      lossy: false,
      geotiff: true,
    });
  });

  it("keeps only lossless formats free of the lossy flag", () => {
    expect(CONST.FORMAT.png.lossy).toBe(false);

    expect(CONST.FORMAT.geotiff.lossy).toBe(false);

    expect(CONST.FORMAT.jpeg.lossy).toBe(true);

    expect(CONST.FORMAT.webp.lossy).toBe(true);
  });

  it("has no DEFAULT or tif fallback key", () => {
    expect(Object.prototype.hasOwnProperty.call(CONST.FORMAT, "DEFAULT")).toBe(false);

    expect(Object.prototype.hasOwnProperty.call(CONST.FORMAT, "tif")).toBe(false);
  });
});

describe("resolveFormat", () => {
  it("returns the key for every known format", () => {
    for (const fmt of Object.keys(CONST.FORMAT))
      expect(CONST.resolveFormat(fmt)).toBe(fmt);
  });

  it("falls back to png for unknown or missing values", () => {
    expect(CONST.resolveFormat("tif")).toBe("png");

    expect(CONST.resolveFormat("jpeg2000")).toBe("png");

    expect(CONST.resolveFormat(undefined)).toBe("png");

    expect(CONST.resolveFormat()).toBe("png");
  });

  it("rejects inherited property names", () => {
    expect(CONST.resolveFormat("constructor")).toBe("png");
  });
});

describe("currentFormat", () => {
  it("returns the record for CONF.format", () => {
    window.CONF = { ...window.CONF, format: "jpeg" };

    expect(CONST.currentFormat()).toBe(CONST.FORMAT.jpeg);
  });

  it("resolves geotiff through the table, not a hardcoded branch", () => {
    window.CONF = { ...window.CONF, format: "geotiff" };

    expect(CONST.currentFormat().geotiff).toBe(true);

    expect(CONST.currentFormat().ext).toBe("tif");
  });

  it("falls back to png when CONF.format is absent", () => {
    const saved = window.CONF;

    delete (window.CONF as Record<string, unknown>).format;
    try {
      expect(CONST.currentFormat()).toBe(CONST.FORMAT.png);
    } finally {
      window.CONF = saved;
    }
  });
});

describe("MIME_LOSSLESS", () => {
  it("is the png mime for intermediate snapshots", () => {
    expect(CONST.MIME_LOSSLESS).toBe(CONST.FORMAT.png.mime);

    expect(CONST.MIME_LOSSLESS).toBe("image/png");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.COLLAPSED).toBe("collapsed");

    expect(CONST.CLASSES.LOCKED).toBe("locked");

    expect(CONST.CLASSES.DRAGGING).toBe("dragging");
  });
});

describe("SVG_NS", () => {
  it("is the SVG namespace", () => {
    expect(CONST.SVG_NS).toBe("http://www.w3.org/2000/svg");
  });
});

describe("SEL", () => {
  it("defines selectors", () => {
    expect(CONST.SEL.SKIP_EXPORT).toBe('[data-foliplus-export="exclude"]');

    expect(CONST.SEL.LABEL).toBe("[data-foliplus-export='label']");
  });
});

// ===========================================================================
// Helper: stub navigator.connection for the detectConcurrency tests.
// Supports standard, moz- and webkit- prefixed APIs.
// ===========================================================================
type ConnStub = { effectiveType?: string; downlink?: number };

function stubConnection(
  kind: "standard" | "moz" | "webkit" | "none",
  stub: ConnStub = {},
) {
  for (const key of ["connection", "mozConnection", "webkitConnection"] as const) {
    try {
      delete (navigator as any)[key];
    } catch {
      /* not present */
    }
  }
  if (kind === "none") return;

  const target =
    kind === "moz"
      ? "mozConnection"
      : kind === "webkit"
        ? "webkitConnection"
        : "connection";

  Object.defineProperty(navigator, target, {
    configurable: true,
    get: () => ({ effectiveType: "4g", downlink: 10, ...stub }),
  });
}

describe("detectConcurrency", () => {
  afterEach(() => stubConnection("none"));

  it("falls back to 6 when no network API is available", () => {
    stubConnection("none");

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it.each([
    ["offline", 0],
    ["slow-2g", 2],
    ["2g", 2],
    ["3g", 4],
    ["4g", 6],
    ["bluetooth", 6],
    ["wifi", 6],
    ["unknown-bucket", 6],
  ])("picks sane value for effectiveType=%s", (et, expected) => {
    stubConnection("standard", { effectiveType: et, downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(expected);
  });

  it("works through the moz-prefixed API (Firefox)", () => {
    stubConnection("moz", { effectiveType: "3g", downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(4);
  });

  it("works through the webkit-prefixed API (Safari)", () => {
    stubConnection("webkit", { effectiveType: "4g", downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("prefers downlink over effectiveType on slow links", () => {
    stubConnection("standard", { effectiveType: "4g", downlink: 0.05 });

    expect(CONST.detectConcurrency()).toBe(1);
  });

  it("scales across downlink buckets", () => {
    stubConnection("standard", { effectiveType: "4g", downlink: 0.5 });

    expect(CONST.detectConcurrency()).toBe(2);

    stubConnection("standard", { effectiveType: "4g", downlink: 2 });

    expect(CONST.detectConcurrency()).toBe(4);

    stubConnection("standard", { effectiveType: "4g", downlink: 100 });

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("ignores downlink=0 and falls back to effectiveType", () => {
    stubConnection("standard", { effectiveType: "3g", downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(4);
  });

  it("ignores missing downlink property", () => {
    stubConnection("standard", { effectiveType: "2g", downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(2);
  });

  it("ignores string-typed downlink", () => {
    stubConnection("standard", { effectiveType: "4g", downlink: "10" as any });

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("prefers downlink over effectiveType even when effectiveType is missing", () => {
    stubConnection("standard", { downlink: 2 });

    expect(CONST.detectConcurrency()).toBe(4);
  });

  it("falls back to default when effectiveType missing and downlink is 0", () => {
    stubConnection("standard", { downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("handles downlink=Infinity as fast link", () => {
    stubConnection("standard", { effectiveType: "4g", downlink: Infinity });

    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("never returns a negative value across all bucket × downlink combos", () => {
    for (const et of ["offline", "slow-2g", "2g", "3g", "4g", "bogus"]) {
      for (const dl of [0, 0.1, 1, 5, 100]) {
        stubConnection("standard", { effectiveType: et, downlink: dl });

        expect(CONST.detectConcurrency()).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("prefers standard API over moz-prefixed when both exist", () => {
    stubConnection("moz", { effectiveType: "2g", downlink: 0 });

    stubConnection("standard", { effectiveType: "4g", downlink: 0 });

    expect(CONST.detectConcurrency()).toBe(6);
  });
});

// ===========================================================================
// TILE_CONCURRENCY — evaluated once at module load.  In vitest CONF is {}
// so TILE_CONCURRENCY = detectConcurrency() with no network API → 6.
// ===========================================================================
describe("TILE_CONCURRENCY", () => {
  it("is a positive integer", () => {
    expect(CONST.TILE_CONCURRENCY).toBeGreaterThanOrEqual(1);

    expect(Number.isInteger(CONST.TILE_CONCURRENCY)).toBe(true);
  });

  it("stays within sane bounds", () => {
    expect(CONST.TILE_CONCURRENCY).toBeLessThanOrEqual(64);
  });

  it("defaults to 6 when no network API is present", () => {
    expect(CONST.TILE_CONCURRENCY).toBe(6);
  });

  it("is wired to detectConcurrency", () => {
    expect(CONST.detectConcurrency()).toBe(CONST.TILE_CONCURRENCY);
  });
});
