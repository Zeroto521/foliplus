import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/LayerControl/const.js";
import { GEOM_TYPE, RECURSION, Z_INDEX } from "#foliplus/core/layer/const.js";

describe("INIT_DELAY_MS", () => {
  it("is a positive number", () => {
    expect(CONST.INIT_DELAY_MS).toBe(300);
  });
});

describe("Z_INDEX", () => {
  it("defines z-index values", () => {
    expect(Z_INDEX.BASE).toBe(600);
    expect(Z_INDEX.STEP).toBe(10);
  });
});

describe("RECURSION", () => {
  it("defines recursion depth limits", () => {
    expect(RECURSION.LAYER_DEPTH).toBe(10);
  });
});

describe("STORAGE", () => {
  it("derives keys from map container id", () => {
    expect(CONST.STORAGE.ORDER_KEY).toContain("foliplus_layer_order_");
    expect(CONST.STORAGE.FOLD_KEY).toContain("foliplus_fold_state_");
    expect(CONST.STORAGE.VISIBILITY_KEY).toContain("foliplus_layer_visibility_");
  });
});

describe("COLOR", () => {
  it("defines color map id and default value", () => {
    expect(CONST.COLOR.MAP_ID).toBe("foliplus_color_map");
    expect(CONST.COLOR.DEFAULT).toBe("#cccccc");
  });
});

describe("CLASSES", () => {
  it("defines layer item and interaction classes", () => {
    expect(CONST.CLASSES.LAYER_ITEM).toBe("foliplus-layer-item");
    expect(CONST.CLASSES.ACTIVE).toBe("active");
    expect(CONST.CLASSES.DRAGGING).toBe("foliplus-layer-dragging");
    expect(CONST.CLASSES.DRAG_OVER_TOP).toBe("foliplus-layer-drag-over-top");
    expect(CONST.CLASSES.DRAG_OVER_BOTTOM).toBe("foliplus-layer-drag-over-bottom");
  });

  it("defines grid column classes", () => {
    expect(CONST.CLASSES.DRAG_CELL).toBe("foliplus-drag-cell");
    expect(CONST.CLASSES.CHECKBOX).toBe("foliplus-checkbox");
    expect(CONST.CLASSES.LAYER_LABEL).toBe("foliplus-layer-label");
    expect(CONST.CLASSES.COUNT_COL).toBe("foliplus-layer-count");
    expect(CONST.CLASSES.TYPE_ICON_COL).toBe("foliplus-type-icon-col");
    expect(CONST.CLASSES.MORE_BTN).toBe("foliplus-layer-more-btn");
  });

  it("defines fold and toggle-all classes", () => {
    expect(CONST.CLASSES.FOLD_BTN).toBe("foliplus-layer-fold-btn");
    expect(CONST.CLASSES.FOLDED).toBe("foliplus-layer-folded");
    expect(CONST.CLASSES.TOGGLE_ALL).toBe("foliplus-layer-toggle-all");
    expect(CONST.CLASSES.FOLD_BTN_CTR).toBe("foliplus-layer-sep");
    expect(CONST.CLASSES.SEP_LABEL).toBe("foliplus-layer-sep-label");
    expect(CONST.CLASSES.GROUP_FOLDED).toBe("foliplus-layer-group-folded");
  });

  it("defines color and utility classes", () => {
    expect(CONST.CLASSES.COLOR_INPUT).toBe("foliplus-color-layer-input");
    expect(CONST.CLASSES.COLOR_ITEM).toBe("foliplus-color-layer-item");
    expect(CONST.CLASSES.HIDDEN).toBe("hidden");
    expect(CONST.CLASSES.FOCUSED).toBe("foliplus-layer-focused");
  });
});

describe("DATA", () => {
  it("defines data attribute names", () => {
    expect(CONST.DATA.INDEX).toBe("data-index");
    expect(CONST.DATA.LAYER_ID).toBe("data-layer-id");
    expect(CONST.DATA.COUNT).toBe("data-item-count");
    expect(CONST.DATA.TITLE).toBe("data-item-title");
  });
});

describe("SEL", () => {
  it("defines DOM selectors", () => {
    expect(CONST.SEL.LAYER_ITEM).toBe(".foliplus-layer-item");
    expect(CONST.SEL.COLOR_ITEM).toBe(".foliplus-color-layer-item");
    expect(CONST.SEL.COLOR_INPUT).toBe(".foliplus-color-layer-input");
    expect(CONST.SEL.TOGGLE_ALL).toBe(".foliplus-layer-toggle-all");
    expect(CONST.SEL.COUNT_COL).toBe(".foliplus-layer-count");
  });
});

describe("GEOM_TYPE", () => {
  it("defines geometry type names", () => {
    expect(GEOM_TYPE.POINT).toBe("point");
    expect(GEOM_TYPE.LINE).toBe("line");
    expect(GEOM_TYPE.POLYGON).toBe("polygon");
    expect(GEOM_TYPE.EMPTY).toBe("empty");
    expect(GEOM_TYPE.UNKNOWN).toBe("unknown");
  });
});

describe("GROUP", () => {
  it("defines group names", () => {
    expect(CONST.GROUP.OVERLAY).toBe("overlay");
    expect(CONST.GROUP.BASE).toBe("base");
  });
});

describe("FOCUS", () => {
  it("defines the focus rectangle duration in milliseconds", () => {
    expect(CONST.FOCUS.RECT_DURATION_MS).toBe(3500);
  });

  it("defines the fitBounds animation duration", () => {
    expect(CONST.FOCUS.FIT_DURATION).toBe(0.6);
  });

  it("defines padding as a [topBottom, leftRight] tuple", () => {
    expect(CONST.FOCUS.PADDING).toEqual([32, 32]);
  });

  it("defines the max zoom step cap", () => {
    expect(CONST.FOCUS.MAX_ZOOM_STEP).toBe(6);
  });

  it("defines the minimum bounds area threshold for flyTo fallback", () => {
    expect(CONST.FOCUS.MIN_BOUNDS_AREA).toBe(0.0001);
  });

  it("defines the opacity of the dim-outside mask", () => {
    expect(CONST.FOCUS.MASK_OPACITY).toBe(0.4);
  });

  it("defines the focus overlay pane z-index", () => {
    expect(CONST.FOCUS.PANE_Z).toBe(9000);
  });
});

describe("CLASSES.FOCUSING", () => {
  it("defines the focusing row class", () => {
    expect(CONST.CLASSES.FOCUSING).toBe("foliplus-layer-focusing");
  });
});

describe("CLASSES.FOCUS_ACTIVE / FOCUS_PANE / FOCUS_GLOW", () => {
  it("defines the container + focused-pane classes for declarative hiding", () => {
    expect(CONST.CLASSES.FOCUS_ACTIVE).toBe("foliplus-focus-active");
    expect(CONST.CLASSES.FOCUS_PANE).toBe("foliplus-focus-pane");
    expect(CONST.CLASSES.FOCUS_GLOW).toBe("foliplus-focus-glow");
  });
});
