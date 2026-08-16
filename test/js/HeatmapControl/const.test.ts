import * as CONST from "#foliplus/HeatmapControl/const.js";
import { describe, expect, it } from "vitest";

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

describe("METHOD", () => {
  it("defines standard classification methods", () => {
    expect(CONST.METHOD.JENKS).toBe("jenks");
    expect(CONST.METHOD.QUANTILE).toBe("quantile");
    expect(CONST.METHOD.EQUAL).toBe("equal");
    expect(CONST.METHOD.HEADS).toBe("heads");
  });
});

describe("CLASS_COUNT", () => {
  it("defines valid range and default", () => {
    expect(CONST.CLASS_COUNT.MIN).toBe(2);
    expect(CONST.CLASS_COUNT.MAX).toBe(9);
    expect(CONST.CLASS_COUNT.DEFAULT).toBe(6);
  });
});

describe("BORDER", () => {
  it("defines weight constraints", () => {
    expect(CONST.BORDER.WEIGHT_MIN).toBe(0);
    expect(CONST.BORDER.WEIGHT_MAX).toBe(10);
    expect(CONST.BORDER.WEIGHT_STEP).toBe(0.5);
    expect(CONST.BORDER.WEIGHT_DEFAULT).toBe(1);
  });
});

describe("HM_DATA_ATTR", () => {
  it("defines all data-hm-* attribute names", () => {
    expect(CONST.HM_DATA_ATTR.LAYER).toBe("data-hm-layer");
    expect(CONST.HM_DATA_ATTR.EXTRA_BODY).toBe("data-hm-extra-body");
    expect(CONST.HM_DATA_ATTR.AGG).toBe("data-hm-agg");
    expect(CONST.HM_DATA_ATTR.FIELD).toBe("data-hm-field");
    expect(CONST.HM_DATA_ATTR.FIELD_SELECT).toBe("data-hm-field-select");
    expect(CONST.HM_DATA_ATTR.METHOD).toBe("data-hm-method");
    expect(CONST.HM_DATA_ATTR.CLASS_COUNT).toBe("data-hm-class-count");
    expect(CONST.HM_DATA_ATTR.SCHEME_CTRL).toBe("data-hm-scheme-ctrl");
    expect(CONST.HM_DATA_ATTR.SCHEME_HIDDEN).toBe("data-hm-scheme-hidden");
    expect(CONST.HM_DATA_ATTR.BORDER_COLOR).toBe("data-hm-border-color");
    expect(CONST.HM_DATA_ATTR.BORDER_WEIGHT).toBe("data-hm-border-weight");
    expect(CONST.HM_DATA_ATTR.LABEL_CHK).toBe("data-hm-label-chk");
    expect(CONST.HM_DATA_ATTR.BTN_CLEAR).toBe("data-hm-btn-clear");
    expect(CONST.HM_DATA_ATTR.BTN_CONFIRM).toBe("data-hm-btn-confirm");
  });

  it("has 14 data-hm attribute keys", () => {
    const keys = Object.keys(CONST.HM_DATA_ATTR);
    expect(keys.length).toBe(14);
  });
});
