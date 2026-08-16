import * as CONST from "#foliplus/ExportControl/const.js";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(CONST.TIMING.URL_REVOKE_DELAY).toBeGreaterThan(0);
    expect(CONST.TIMING.RESTORE_DELAY).toBeGreaterThan(0);
  });
});

describe("MIME", () => {
  it("maps format to mime type", () => {
    expect(CONST.MIME.png).toBe("image/png");
    expect(CONST.MIME.jpeg).toBe("image/jpeg");
    expect(CONST.MIME.webp).toBe("image/webp");
    expect(CONST.MIME.DEFAULT).toBe("image/png");
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

describe("CACHE", () => {
  it("defines cache limits", () => {
    expect(CONST.CACHE.UNDO_MAX).toBe(20);
    expect(CONST.CACHE.TILE_MAX).toBe(1000);
  });
});

// ===========================================================================
// Helper: stub navigator.connection for the detectConcurrency tests.
// Supports standard, moz- and webkit- prefixed APIs so we cover all three.
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

  it("ignores non-numeric downlink", () => {
    stubConnection("standard", { effectiveType: "4g", downlink: "fast" as any });
    expect(CONST.detectConcurrency()).toBe(6);
  });

  it("prefers downlink over effectiveType even when effectiveType is missing", () => {
    stubConnection("standard", { downlink: 2 });
    expect(CONST.detectConcurrency()).toBe(4);
  });

  it("falls back to default when effectiveType is missing AND downlink is 0", () => {
    stubConnection("standard", { downlink: 0 });
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
// resolveTileConcurrency — pure parser for CONF.tile_concurrency.  Exercises
// every CONF-driven branch directly without re-importing the module.
// ===========================================================================
describe("resolveTileConcurrency", () => {
  afterEach(() => stubConnection("none"));

  describe("auto / fallback branches", () => {
    it.each([
      [undefined, 6],
      [null, 6],
      ["auto", 6],
      [true, 6],
      ["nope", 6],
      [{}, 6],
      [[], 6],
    ])("falls back to detectConcurrency for %s", (raw, expected) => {
      expect(CONST.resolveTileConcurrency(raw as any)).toBe(expected);
    });
  });

  describe("numeric inputs", () => {
    it.each([
      [1, 1],
      [6, 6],
      [10, 10],
      [0, 1],
      [-1, 1],
      [-100, 1],
      [3.7, 3],
      [3.1, 3],
      [128, 128],
    ])("returns %p for number input %s", (raw, expected) => {
      expect(CONST.resolveTileConcurrency(raw as any)).toBe(expected);
    });
  });

  describe("numeric string inputs", () => {
    it.each([
      ["1", 1],
      ["6", 6],
      ["0", 1],
      ["-2", 1],
      ["128", 128],
    ])("returns %p for numeric string '%s'", (raw, expected) => {
      expect(CONST.resolveTileConcurrency(raw)).toBe(expected);
    });

    it.each(["foo", "auto", "6abc"])(
      "falls back to detectConcurrency for non-numeric string '%s'",
      raw => {
        expect(CONST.resolveTileConcurrency(raw)).toBe(6);
      },
    );
  });

  describe("downlink-aware auto detection", () => {
    it("detects slow 4g link when CONF.tile_concurrency is 'auto'", () => {
      stubConnection("standard", { effectiveType: "4g", downlink: 0.5 });
      expect(CONST.resolveTileConcurrency("auto")).toBe(2);
    });

    it("detects fast 4g link when CONF.tile_concurrency is true", () => {
      stubConnection("standard", { effectiveType: "4g", downlink: 100 });
      expect(CONST.resolveTileConcurrency(true)).toBe(6);
    });

    it("detects 2g link when CONF.tile_concurrency is undefined", () => {
      stubConnection("standard", { effectiveType: "2g", downlink: 0 });
      expect(CONST.resolveTileConcurrency(undefined)).toBe(2);
    });

    it("combines numeric CONF override with auto fallback path", () => {
      stubConnection("standard", { effectiveType: "4g", downlink: 0.5 });
      // Even though auto would pick 2, an explicit number wins.
      expect(CONST.resolveTileConcurrency(8)).toBe(8);
      expect(CONST.resolveTileConcurrency("auto")).toBe(2);
    });
  });
});

// ===========================================================================
// TILE_CONCURRENCY — evaluated once at module load.  vitest.config.mjs
// defines CONF as {}, so CONF.tile_concurrency is undefined → default branch.
// ===========================================================================
describe("TILE_CONCURRENCY", () => {
  it("is a positive integer", () => {
    expect(CONST.TILE_CONCURRENCY).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(CONST.TILE_CONCURRENCY)).toBe(true);
  });

  it("stays within sane bounds", () => {
    expect(CONST.TILE_CONCURRENCY).toBeLessThanOrEqual(64);
  });

  it("defaults to 6 when CONF.tile_concurrency is absent", () => {
    expect(CONST.TILE_CONCURRENCY).toBe(6);
  });

  it("is wired to resolveTileConcurrency", () => {
    expect(CONST.resolveTileConcurrency(undefined)).toBe(CONST.TILE_CONCURRENCY);
  });
});
