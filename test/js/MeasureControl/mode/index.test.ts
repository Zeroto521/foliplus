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

  it("covers all CONST.MODE keys except clear and edit", () => {
    const modeKeys = Object.values(CONST.MODE).filter(
      k => k !== "clear" && k !== "edit",
    );
    for (const key of modeKeys) {
      expect(MODE_MAP[key]).toBeDefined();
    }

    // EDIT is a global overlay mode, not a layer-drawing mode — it has no
    // entry in MODE_MAP (there is no EditMode class).
    expect(MODE_MAP[CONST.MODE.EDIT]).toBeUndefined();
  });
});
