import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/HeatmapControl/HeatmapControl.const.js";

describe("TIMING", () => {
  it("has expected debounce values", () => {
    expect(CONST.TIMING.ZOOM_DEBOUNCE).toBe(200);
    expect(CONST.TIMING.LAYER_SCAN_DEBOUNCE).toBe(200);
    expect(CONST.TIMING.LOAD_SCRIPT_RETRIES).toBe(2);
  });
});

describe("H3", () => {
  it("has RES_MAP with resolution pairs", () => {
    expect(CONST.H3.RES_MAP.length).toBeGreaterThan(0);
    const [z, r] = CONST.H3.RES_MAP[0];
    expect(typeof z).toBe("number");
    expect(typeof r).toBe("number");
  });

  it("has a fallback resolution", () => {
    expect(CONST.H3.RES_FALLBACK).toBe(12);
  });
});

describe("AGG", () => {
  it("defines standard aggregation methods", () => {
    expect(CONST.AGG.COUNT).toBe("count");
    expect(CONST.AGG.SUM).toBe("sum");
    expect(CONST.AGG.AVG).toBe("avg");
    expect(CONST.AGG.MIN).toBe("min");
    expect(CONST.AGG.MAX).toBe("max");
  });
});

describe("CLASSES", () => {
  it("has expected CSS class constants", () => {
    expect(CONST.CLASSES.FORM_ROW).toBe("foliplus-heatmap-form-row");
    expect(CONST.CLASSES.BTN_CONFIRM).toBe("foliplus-heatmap-btn-confirm");
    expect(CONST.CLASSES.HEATMAP_CTRL).toBe("foliplus-heatmap-ctrl");
  });
});

describe("SEL", () => {
  it("has expected selectors", () => {
    expect(CONST.SEL.SCHEME_BAR).toBe(".foliplus-heatmap-scheme-bar");
    expect(CONST.SEL.FORM_SELECT).toBe(".foliplus-heatmap-form-select");
  });
});

describe("GRAY", () => {
  it("is a default fill color", () => {
    expect(CONST.GRAY).toBe("#999");
  });
});

describe("ID", () => {
  it("is the canvas identifier", () => {
    expect(CONST.ID).toBe("foliplus_heatmap");
  });
});
