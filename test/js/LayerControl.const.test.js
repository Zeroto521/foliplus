import { describe, expect, it } from "vitest";
import * as CONST from "../../foliplus/js/LayerControl/LayerControl.const.js";

describe("INIT_DELAY_MS", () => {
  it("is a positive number", () => {
    expect(CONST.INIT_DELAY_MS).toBe(300);
  });
});

describe("Z_INDEX", () => {
  it("defines z-index values", () => {
    expect(CONST.Z_INDEX.BASE).toBe(600);
    expect(CONST.Z_INDEX.STEP).toBe(10);
  });
});

describe("RECURSION", () => {
  it("defines recursion depth limits", () => {
    expect(CONST.RECURSION.LAYER_DEPTH).toBe(10);
  });
});

describe("STORAGE", () => {
  it("derives keys from map container id", () => {
    expect(CONST.STORAGE.ORDER_KEY).toContain("foliplus_layer_order_");
    expect(CONST.STORAGE.FOLD_KEY).toContain("foliplus_fold_state_");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.LAYER_ITEM).toBe("foliplus-layer-item");
    expect(CONST.CLASSES.DRAGGING).toBe("foliplus-layer-dragging");
    expect(CONST.CLASSES.FOLD_BTN).toBe("foliplus-layer-fold-btn");
  });
});

describe("GEOM_TYPE", () => {
  it("defines geometry type names", () => {
    expect(CONST.GEOM_TYPE.POINT).toBe("point");
    expect(CONST.GEOM_TYPE.LINE).toBe("line");
    expect(CONST.GEOM_TYPE.POLYGON).toBe("polygon");
    expect(CONST.GEOM_TYPE.EMPTY).toBe("empty");
    expect(CONST.GEOM_TYPE.UNKNOWN).toBe("unknown");
  });
});

describe("GROUP", () => {
  it("defines group names", () => {
    expect(CONST.GROUP.OVERLAY).toBe("overlay");
    expect(CONST.GROUP.BASE).toBe("base");
  });
});
