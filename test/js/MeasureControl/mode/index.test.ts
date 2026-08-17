import { describe, expect, it } from "vitest";
import * as CONST from "#foliplus/MeasureControl/const.js";
import {
  CircleMode,
  DistanceMode,
  MODE_MAP,
  MarkerMode,
  PolygonMode,
} from "#foliplus/MeasureControl/mode/index.js";

describe("MODE_MAP", () => {
  it("maps all four mode types to their classes", () => {
    expect(MODE_MAP[CONST.MODE.MARKER]).toBe(MarkerMode);
    expect(MODE_MAP[CONST.MODE.DISTANCE]).toBe(DistanceMode);
    expect(MODE_MAP[CONST.MODE.POLYGON]).toBe(PolygonMode);
    expect(MODE_MAP[CONST.MODE.CIRCLE]).toBe(CircleMode);
  });

  it("covers all CONST.MODE keys except clear", () => {
    const modeKeys = Object.values(CONST.MODE).filter(k => k !== "clear");
    for (const key of modeKeys) {
      expect(MODE_MAP[key]).toBeDefined();
    }
  });
});
