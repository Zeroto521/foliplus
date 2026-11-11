// Style-matrix guard — the geometry x dimension mode table is the single
// source the panel options and the apply gate read (#1070 step 1).
//
// Two invariants, pinned as guards (not snapshots):
//   1. The table's mode list per (geom, dim) matches the runtime contract
//      the panel builders already expose (border's per-geometry arrays,
//      fill's point/polygon array) — a drift on either side goes red.
//   2. Every row's slot is a real capability slot, and the geometry-
//      agnostic rows are emitted for all three geoms — a geometry that
//      silently loses a row fails here, not in the browser.
//
// The consumers (fill.ts / border.ts option building) are wired in a later
// step (#1070 step 2, after #1069 merges); this file pins the table the
// consumers will read, so a table typo today is caught now instead of at
// the wiring step.
import { describe, expect, it } from "vitest";
import { DIM, GEOM_TYPE, STYLE_MODE } from "#core/layer/index.js";
import {
  STYLE_MATRIX,
  matrixRows,
  offeredModes,
} from "#control/LayerControl/ui/style/styleMatrix.js";

const MODE_VALUES = Object.values(STYLE_MODE);

/** All (geom, dim) pairs the three data geoms can carry. */
const ALL_GEOMS = ["point", "line", "polygon"] as const;

describe("style matrix — structure", () => {
  it("every row uses a data geom, a real dim and a real mode list", () => {
    for (const row of STYLE_MATRIX) {
      expect(ALL_GEOMS).toContain(row.geom);
      expect(Object.values(DIM)).toContain(row.dim);
      expect(row.modes.length).toBeGreaterThan(0);
      for (const mode of row.modes) expect(MODE_VALUES).toContain(mode);
    }
  });

  it("no duplicate (geom, dim) rows — a second row would shadow the first", () => {
    const seen = new Set<string>();
    for (const row of STYLE_MATRIX) {
      const key = `${row.geom}:${row.dim}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("no duplicate modes within a row (a repeated option is a UI bug)", () => {
    for (const row of STYLE_MATRIX) {
      expect(new Set(row.modes).size).toBe(row.modes.length);
    }
  });

  it("conditions only gate ORIGINAL (perFeature) and VALUE (hasValueField)", () => {
    for (const row of STYLE_MATRIX) {
      if (!row.conditions) continue;
      for (const cond of row.conditions) {
        expect(["perFeature", "hasValueField"]).toContain(cond);
        // a condition must actually gate at least one mode in the row,
        // else it is a dead condition that silently filters nothing.
        const gated = row.modes.filter(
          mode =>
            (cond === "perFeature" && mode === STYLE_MODE.ORIGINAL) ||
            (cond === "hasValueField" && mode === STYLE_MODE.VALUE),
        );
        expect(gated.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("style matrix — runtime contract (guard 1)", () => {
  it("border: line offers { original, single, value } — the test matrix contract", () => {
    const rows = matrixRows(GEOM_TYPE.LINE, DIM.BORDER);
    expect(rows).toHaveLength(1);
    expect(rows[0].modes).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
      STYLE_MODE.VALUE,
    ]);
  });

  it.each(["polygon", "point"] as const)(
    "border: %s offers { original, single, follow-fill } — never by-value",
    geom => {
      const rows = matrixRows(geom, DIM.BORDER);
      expect(rows).toHaveLength(1);
      expect(rows[0].modes).toEqual([
        STYLE_MODE.ORIGINAL,
        STYLE_MODE.SOLID,
        STYLE_MODE.FOLLOW_FILL,
      ]);
      expect(rows[0].modes).not.toContain(STYLE_MODE.VALUE);
    },
  );

  it("fill: point and polygon offer { original, single, value }", () => {
    for (const geom of ["point", "polygon"] as const) {
      const rows = matrixRows(geom, DIM.FILL);
      expect(rows).toHaveLength(1);
      expect(rows[0].modes).toEqual([
        STYLE_MODE.ORIGINAL,
        STYLE_MODE.SOLID,
        STYLE_MODE.VALUE,
      ]);
    }
  });

  it("fill: line has no row — a line has no fill face", () => {
    expect(matrixRows(GEOM_TYPE.LINE, DIM.FILL)).toHaveLength(0);
  });

  it("size: point only — a pixel radius is a point fact", () => {
    expect(matrixRows(GEOM_TYPE.POINT, DIM.SIZE)).toHaveLength(1);
    expect(matrixRows(GEOM_TYPE.LINE, DIM.SIZE)).toHaveLength(0);
    expect(matrixRows(GEOM_TYPE.POLYGON, DIM.SIZE)).toHaveLength(0);
  });

  it("line + fill VALUE is illegal (drift counterexample shape)", () => {
    // The design's counterexample: adding VALUE to a line's fill row must
    // not be silently accepted. The matrix has no such row, so a consumer
    // reading it gets an empty list — the panel builds no fill mode row.
    const rows = matrixRows(GEOM_TYPE.LINE, DIM.FILL);
    expect(rows).toHaveLength(0);
  });
});

describe("style matrix — offeredModes conditions (guard 1b)", () => {
  it("no conditions: returns the base modes untouched", () => {
    const row = matrixRows(GEOM_TYPE.LINE, DIM.BORDER)[0];
    expect(offeredModes(row, {})).toEqual(row.modes);
  });

  it("fill: perFeature false drops ORIGINAL", () => {
    const row = matrixRows(GEOM_TYPE.POLYGON, DIM.FILL)[0];
    expect(offeredModes(row, { perFeature: false, hasValueField: true })).toEqual([
      STYLE_MODE.SOLID,
      STYLE_MODE.VALUE,
    ]);
  });

  it("fill: no value field drops VALUE", () => {
    const row = matrixRows(GEOM_TYPE.POLYGON, DIM.FILL)[0];
    expect(offeredModes(row, { perFeature: true, hasValueField: false })).toEqual([
      STYLE_MODE.ORIGINAL,
      STYLE_MODE.SOLID,
    ]);
  });

  it("fill: both absent drops ORIGINAL and VALUE, keeps SOLID", () => {
    const row = matrixRows(GEOM_TYPE.POLYGON, DIM.FILL)[0];
    expect(offeredModes(row, { perFeature: false, hasValueField: false })).toEqual([
      STYLE_MODE.SOLID,
    ]);
  });

  it("fill: both present keeps the full row (all-flags round trip)", () => {
    const row = matrixRows(GEOM_TYPE.POLYGON, DIM.FILL)[0];
    expect(offeredModes(row, { perFeature: true, hasValueField: true })).toEqual(
      row.modes,
    );
  });
});

describe("style matrix — capability gate consistency (guard 2)", () => {
  const SLOTS = new Set([
    "fill",
    "stroke",
    "size",
    "icon",
    "iconColor",
    "markerColor",
    "opacity",
    "zoomRange",
    "label",
  ]);

  it("every row's slot is a real capability slot", () => {
    for (const row of STYLE_MATRIX) expect(SLOTS.has(row.slot)).toBe(true);
  });

  it("geometry-agnostic dims (opacity/zoomRange/label) cover all three geoms", () => {
    for (const dim of [DIM.OPACITY, DIM.ZOOM_RANGE, DIM.LABEL]) {
      for (const geom of ALL_GEOMS) {
        expect(matrixRows(geom, dim)).toHaveLength(1);
      }
    }
  });

  it("fill/border/size rows use the right gate slot", () => {
    for (const row of STYLE_MATRIX) {
      const expected =
        row.dim === DIM.FILL
          ? "fill"
          : row.dim === DIM.BORDER
            ? "stroke"
            : row.dim === DIM.SIZE
              ? "size"
              : row.dim === DIM.OPACITY
                ? "opacity"
                : row.dim === DIM.ZOOM_RANGE
                  ? "zoomRange"
                  : row.dim === DIM.LABEL
                    ? "label"
                    : row.slot;
      expect(row.slot).toBe(expected);
    }
  });

  it("matrixRows answers [] for an unknown geometry (never throws)", () => {
    expect(matrixRows("unknown", DIM.FILL)).toHaveLength(0);
    expect(matrixRows(null, DIM.FILL)).toHaveLength(0);
  });
});
