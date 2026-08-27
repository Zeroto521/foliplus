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
