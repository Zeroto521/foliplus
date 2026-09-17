import { describe, expect, it } from "vitest";
import { generateId } from "#core/component.js";
import * as CONST from "#foliplus/HeatmapControl/const.js";

describe("TIMING", () => {
  it("has expected debounce values", () => {
    expect(CONST.TIMING.ZOOM_DEBOUNCE).toBe(200);
    expect(CONST.TIMING.LAYER_SCAN_DEBOUNCE).toBe(200);
    // The init-scan and script-load constants were removed: the scan is
    // signal-driven and script loading is handled elsewhere.
    expect(
      (CONST.TIMING as Record<string, unknown>).INIT_SCAN_TIMEOUT_MS,
    ).toBeUndefined();
    expect(
      (CONST.TIMING as Record<string, unknown>).LOAD_SCRIPT_RETRIES,
    ).toBeUndefined();
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
    // form-row/label/control/select and the toggle live in common/form.css
    // as shared foliplus-form-* classes — not component constants.
    // The confirm button is gone: every control re-renders live.
    expect((CONST.CLASSES as Record<string, unknown>).BTN_CONFIRM).toBeUndefined();
    expect(CONST.CLASSES.HEATMAP_CTRL).toBe("foliplus-heatmap-ctrl");
  });

  it("HIDDEN is the shared foliplus-hidden class", () => {
    // Extra body / field toggling reuses the shared hidden class instead of
    // a component-local `.hidden` (which collided with Bootstrap's .hidden).
    expect(CONST.CLASSES.HIDDEN).toBe("foliplus-hidden");
  });
});

describe("SEL", () => {
  it("has expected selectors", () => {
    expect(CONST.SEL.SCHEME_BAR).toBe(".foliplus-heatmap-scheme-bar");
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

describe("DATA_ATTR", () => {
  it("defines all data-heatmap-* attribute names", () => {
    expect(CONST.DATA_ATTR.LAYER).toBe("data-heatmap-layer");
    expect(CONST.DATA_ATTR.EXTRA_BODY).toBe("data-heatmap-extra-body");
    expect(CONST.DATA_ATTR.AGG).toBe("data-heatmap-agg");
    expect(CONST.DATA_ATTR.FIELD).toBe("data-heatmap-field");
    expect(CONST.DATA_ATTR.FIELD_SELECT).toBe("data-heatmap-field-select");
    expect(CONST.DATA_ATTR.METHOD).toBe("data-heatmap-method");
    expect(CONST.DATA_ATTR.CLASS_COUNT).toBe("data-heatmap-class-count");
    expect(CONST.DATA_ATTR.SCHEME_CTRL).toBe("data-heatmap-scheme-ctrl");
    expect(CONST.DATA_ATTR.SCHEME_HIDDEN).toBe("data-heatmap-scheme-hidden");
    expect(CONST.DATA_ATTR.BORDER_COLOR).toBe("data-heatmap-border-color");
    expect(CONST.DATA_ATTR.BORDER_WEIGHT).toBe("data-heatmap-border-weight");
    expect(CONST.DATA_ATTR.LABEL_CHK).toBe("data-heatmap-label-chk");
    expect(CONST.DATA_ATTR.LABEL_FORMAT).toBe("data-heatmap-label-format");
    expect(CONST.DATA_ATTR.BTN_CLEAR).toBe("data-heatmap-btn-clear");
  });

  it("has 14 data-heatmap attribute keys (no confirm button)", () => {
    const keys = Object.keys(CONST.DATA_ATTR);
    expect(keys.length).toBe(14);
  });
});

describe("FORMAT", () => {
  it("matches the annotation panel's number-format vocabulary", () => {
    expect(CONST.FORMAT.AUTO).toBe("auto");
    expect(CONST.FORMAT.INT).toBe("int");
    expect(CONST.FORMAT.COMMA).toBe("comma");
    expect(CONST.FORMAT.PERCENT).toBe("percent");
  });
});

describe("generateId", () => {
  it("returns the default ID when no namespace is provided", () => {
    expect(generateId(CONST.ID)).toBe("foliplus_heatmap");
    expect(generateId(CONST.ID, undefined)).toBe("foliplus_heatmap");
  });

  it("returns a namespaced ID when namespace is provided", () => {
    expect(generateId(CONST.ID, "map2")).toBe("foliplus_heatmap_map2");
    expect(generateId(CONST.ID, "custom")).toBe("foliplus_heatmap_custom");
  });

  it("uses ID constant as prefix for namespaced IDs", () => {
    expect(generateId(CONST.ID, "ns")).toBe(`${CONST.ID}_ns`);
  });
});
