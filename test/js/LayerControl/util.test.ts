import { beforeEach, describe, expect, it, vi } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import * as SVGs from "#foliplus/LayerControl/icon.js";
import { formatCount, getTypeSVG } from "#foliplus/LayerControl/util.js";
import { formatNumber } from "#common/format.js";

class Polygon {}

class Polyline {}

class CircleMarker {}

class Marker {}

const makeContainer = children => ({
  eachLayer: fn => children.forEach(fn),
});

const LOCALE = "en-US";

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(window.L, { Polygon, Polyline, CircleMarker, Marker });
});

describe("getTypeSVG", () => {
  it("maps geometry types to their SVG icons", () => {
    expect(getTypeSVG(makeContainer([new Polygon()]))).toBe(SVGs.POLYGON);
    expect(getTypeSVG(makeContainer([new Polyline()]))).toBe(SVGs.LINE);
    expect(getTypeSVG(makeContainer([]))).toBe(SVGs.EMPTY);
    expect(getTypeSVG(makeContainer([{}]))).toBe(SVGs.UNKNOWN);
  });

  it("shows the point icon only for feature-bearing CircleMarkers", () => {
    // The point icon promises downstream-consumable data (extractPoints /
    // Heatmap), which require .feature. A plain CircleMarker is a geometric
    // point but not consumable, so it shows unknown — not point.
    const cm = new CircleMarker();
    cm.feature = {};
    expect(getTypeSVG(makeContainer([cm]))).toBe(SVGs.POINT);
    expect(getTypeSVG(makeContainer([new CircleMarker()]))).toBe(SVGs.UNKNOWN);
  });
});

describe("formatCount", () => {
  it("keeps every count under the column's digit budget exact", () => {
    expect(formatCount(0, LOCALE)).toBe("0");
    expect(formatCount(1, LOCALE)).toBe("1");
    expect(formatCount(123, LOCALE)).toBe("123");
    expect(formatCount(999, LOCALE)).toBe("999");
  });

  it("compacts the first value the 38px track cannot fit", () => {
    const boundary = 10 ** CONST.COUNT.MAX_DIGITS;
    expect(formatCount(boundary - 1, LOCALE)).toBe("999");
    expect(formatCount(boundary, LOCALE)).toBe("1K");
    expect(formatCount(12000, LOCALE)).toBe("12K");
  });

  it("compacts in the reader's locale, not in English", () => {
    expect(formatCount(12000, "zh-CN")).toBe("1.2万");
    expect(formatCount(12000, "ja-JP")).toBe("1.2万");
  });

  it("every compact reading fits the column's digit budget", () => {
    // The 38px track holds about 3 digits at font-size-xs; this is the
    // measurement that CONST.COUNT.MAX_DIGITS is sized against.
    for (const v of [1000, 2000, 5000, 9999, 10000, 50000, 120000, 999999]) {
      const text = formatCount(v, LOCALE);
      expect(text.length).toBeLessThanOrEqual(CONST.COUNT.MAX_DIGITS + 1);
    }
  });

  it('delegates the exact path to formatNumber("int")', () => {
    expect(formatCount(123, LOCALE)).toBe(formatNumber(123, "int", LOCALE));
  });
});
