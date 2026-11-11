// control/LayerControl/ui/style/styleMatrix — single source of the geometry x dimension mode table.
//
// One row per (geometry, dimension): which style modes the panel offers for that
// combination, which capability slot gates the whole dimension, and which
// per-layer conditions narrow the base mode list. The single source for panel
// options, the apply gate, and the test matrix — a change to one geometry's
// contract lands here first, never in a second copy.
//
// Vocabulary: STYLE_MODE from #core/layer is the mode enum (solid / value /
// original / followFill). GEOM_TYPE supplies the geometry names; DIM the
// dimension names. CapabilitySlot is the registry's own union — this module
// stays a pure data table and never imports a gate (guard 2 in styleMatrix.test
// compares against capabilityGate at the test boundary).
import { DIM, STYLE_MODE, type StyleMode } from "#core/layer/index.js";

/** A geometry name the style matrix keys on. The three data geoms only: a
 *  layer whose geometryType() answers EMPTY / UNKNOWN / CUSTOM has no matrix
 *  row and no style section at all (the capability gate already refuses). */
type MatrixGeom = "point" | "line" | "polygon";

/** The capability slot gating a dimension row. Mirrors the registry's
 *  CapabilitySlot union (kept structural so this pure module does not import
 *  the registry's runtime). */
type CapabilitySlot =
  | "fill"
  | "stroke"
  | "size"
  | "icon"
  | "iconColor"
  | "markerColor"
  | "opacity"
  | "zoomRange"
  | "label";

/** A condition that narrows the offered modes for a concrete layer. The
 *  predicates live at the consumer (fill/border build rows already compute
 *  perFeature / hasValueField); the table names the fact, never re-implements
 *  it — so the second copy the design doc warns against stays out of here. */
type StyleMatrixCondition = "perFeature" | "hasValueField";

/** One (geometry, dimension) row: the base mode list + the gate slot + the
 *  conditions that filter it per layer. */
interface StyleMatrixEntry {
  geom: MatrixGeom;
  dim: (typeof DIM)[keyof typeof DIM];
  modes: readonly StyleMode[];
  slot: CapabilitySlot;
  conditions?: readonly StyleMatrixCondition[];
}

/** The single geometry x dimension -> modes table. Row order = display order.
 *
 *  Rows that are geometry-agnostic (opacity / zoomRange / label) are emitted
 *  for all three geoms by the flatMap below, so a new geometry is never
 *  accidentally missing a row the other two carry. */
const STYLE_MATRIX: readonly StyleMatrixEntry[] = [
  // fill: a line has no fill face (isArealStyleLeaf excludes Polyline);
  // point + polygon carry a fill natively.
  {
    geom: "point",
    dim: DIM.FILL,
    modes: [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.VALUE],
    slot: "fill",
    conditions: ["perFeature", "hasValueField"],
  },
  {
    geom: "polygon",
    dim: DIM.FILL,
    modes: [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.VALUE],
    slot: "fill",
    conditions: ["perFeature", "hasValueField"],
  },
  // border: all three geoms. Value is line-only (borderCarriesValue);
  // point + polygon offer follow-fill (outline over a filled face).
  {
    geom: "point",
    dim: DIM.BORDER,
    modes: [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.FOLLOW_FILL],
    slot: "stroke",
  },
  {
    geom: "line",
    dim: DIM.BORDER,
    modes: [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.VALUE],
    slot: "stroke",
  },
  {
    geom: "polygon",
    dim: DIM.BORDER,
    modes: [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID, STYLE_MODE.FOLLOW_FILL],
    slot: "stroke",
  },
  // size: point only (a pixel radius is a point fact).
  { geom: "point", dim: DIM.SIZE, modes: [STYLE_MODE.SOLID], slot: "size" },
  // geometry-agnostic rows: every geom carries the same single-mode rows.
  ...(["point", "line", "polygon"] as const).flatMap(geom => [
    { geom, dim: DIM.OPACITY, modes: [STYLE_MODE.SOLID], slot: "opacity" } as const,
    {
      geom,
      dim: DIM.ZOOM_RANGE,
      modes: [STYLE_MODE.SOLID],
      slot: "zoomRange",
    } as const,
    { geom, dim: DIM.LABEL, modes: [STYLE_MODE.SOLID], slot: "label" } as const,
  ]),
];

/** Look up the rows for one (geometry, dimension) — the consumer query. An
 *  absent entry means "the panel offers nothing for that combination" (the
 *  capability gate already refused it), never an error. */
const matrixRows = (
  geom: MatrixGeom | string | null | undefined,
  dim: (typeof DIM)[keyof typeof DIM],
): readonly StyleMatrixEntry[] =>
  STYLE_MATRIX.filter(row => row.geom === geom && row.dim === dim);

/** The offered mode list for one (geometry, dimension), with the per-layer
 *  conditions applied. conditions that are absent on the entry are not
 *  filtered; a condition that is absent on the layer (no perFeature, no
 *  value field) drops the modes it gates. */
const offeredModes = (
  entry: StyleMatrixEntry,
  flags: Partial<Record<StyleMatrixCondition, boolean>>,
): readonly StyleMode[] => {
  if (!entry.conditions) return entry.modes;
  const keep = (mode: StyleMode): boolean =>
    entry.conditions!.every(cond => (flags[cond] ?? false) || !modeNeeds(cond, mode));
  return entry.modes.filter(keep);
};

/** Whether a condition gates a specific mode. ORIGINAL needs the author's
 *  per-feature record; VALUE needs a value field to classify. SOLID and
 *  FOLLOW_FILL are never condition-gated. */
const modeNeeds = (cond: StyleMatrixCondition, mode: StyleMode): boolean =>
  (cond === "perFeature" && mode === STYLE_MODE.ORIGINAL) ||
  (cond === "hasValueField" && mode === STYLE_MODE.VALUE);

export { STYLE_MATRIX, matrixRows, offeredModes };
