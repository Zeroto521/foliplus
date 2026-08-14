import { DEL_ICON_CHAR } from "#common/delicon.js";
import * as CONST from "#foliplus/MeasureControl/const.js";
import { describe, expect, it } from "vitest";

describe("TIMING", () => {
  it("defines timing constants", () => {
    expect(CONST.TIMING.CLICK_COOLDOWN).toBe(300);
    expect(CONST.TIMING.FINALIZE_DELAY).toBe(50);
  });
});

describe("DEL_ICON", () => {
  it("defines delete icon config", () => {
    expect(DEL_ICON_CHAR).toBe("\u2715");
  });
  it("defines the delete icon selector", () => {
    expect(CONST.SEL.DEL_ICON).toBe("[data-del-icon]");
  });
});

describe("CLASSES", () => {
  it("defines CSS class constants", () => {
    expect(CONST.CLASSES.ACTIVE).toBe("active");
    expect(CONST.CLASSES.MEASURING).toBe("foliplus-measuring");
    expect(CONST.CLASSES.PATH_SOLID).toContain("foliplus-measure-path-solid");
    expect(CONST.CLASSES.PATH_DASHED).toContain("foliplus-measure-path-dashed");
    expect(CONST.CLASSES.PATH_PREVIEW).toContain("foliplus-measure-path-preview");
    expect(CONST.CLASSES.SHAPE_FILL).toContain("foliplus-measure-shape-fill");
  });
});

describe("MODE", () => {
  it("defines mode names", () => {
    expect(CONST.MODE.DISTANCE).toBe("distance");
    expect(CONST.MODE.POLYGON).toBe("polygon");
    expect(CONST.MODE.CIRCLE).toBe("circle");
    expect(CONST.MODE.MARKER).toBe("marker");
    expect(CONST.MODE.CLEAR).toBe("clear");
  });
});

describe("ID", () => {
  it("is the canvas identifier", () => {
    expect(CONST.ID).toBe("foliplus_measure");
  });
});

describe("PANES", () => {
  it("defines pane names", () => {
    expect(CONST.PANES.GRAPH).toBe("measure_graph");
    expect(CONST.PANES.LABEL).toBe("measure_label");
  });
});

describe("FORMAT", () => {
  it("defines formatting", () => {
    expect(CONST.FORMAT.KM_THRESHOLD).toBe(1000);
    expect(CONST.FORMAT.KM_DECIMALS).toBe(1);
  });
});
