// Value-based stroke rendering — the "Color by value / Stroke by value" arm of
// the border dimension.
//
// This arm is the stroke face's call through the shared by-value mode
// (valuePaint.ts): the skeleton collects values, builds the ramp, writes
// per-leaf `color` and pins the highlight, while this module only supplies
// the face-specific surface — the `ValueFaceDecl`. The declaration carries no
// face literal: the mode body stays face-independent, and a sibling arm
// (fill / size / icon) declares its own surface the same way.
//
// Unlike the fill arm there is no opacity to carry, but the stroke face owns
// one scalar rider of its own: the border `weight`. When the caller passes a
// live width it rides every leaf alongside the ramp color (and the highlight
// replay), so a user-set border width survives the value-stroke write. A
// caller with no width passes `weight` undefined and the rider is absent —
// the author's width stays in force.
//
// The walk is `walkStyleLeaves`, NOT `walkFillLeaves`: the stroke predicate
// is `setStyle` presence, which admits line leaves (Polyline owns a
// setter but is not areal). So one value-stroke dimension covers both the
// line stroke (Gap 2) and the area stroke (Gap 3) without a geometry
// filter — the design's recommended single dimension.
//
// This module is intentionally decoupled from the intent store: the caller
// (the border dimension's write path) owns where the stroke config and the
// active-arm mode live, and supplies the live readers. The engine paints
// exactly what it is asked to.
import { DIM } from "#core/layer/index.js";
import { type FillMode, type FillValueConfig } from "#core/layer/intent.js";
import type { LayerUI } from "../surface.js";
import { FACE, walkStyleLeaves } from "./styleBag.js";
import { type ValueFaceDecl, applyValuePaint } from "./valuePaint.js";

/** The stroke arm in force. An absent mode defers to whether a value config
 *  exists — the pre-mode record shape, where a config alone meant "paint
 *  by value". `FillMode` is reused as the stroke-mode vocabulary: the two
 *  faces own the same literals (solid / value), and the border arm has no
 *  "original" today. Exported so the dimension's `value` readout and the
 *  replay guard agree with the apply path on what the map should show. */
const resolveStrokeMode = (
  mode: FillMode | undefined,
  ramp: FillValueConfig | undefined,
): FillMode => mode ?? (ramp !== undefined ? ("value" as const) : ("solid" as const));

/** Apply a value-based stroke to one layer — the stroke face's call through
 *  the shared by-value mode. The declaration below tells the mode what the
 *  stroke face is; the two optional readers are the stroke's own (the mode
 *  defaults to the declaration's). The mode collects, builds, writes and
 *  pins — no two-pass machinery lives here. */
const applyValueStroke = (
  ui: LayerUI,
  layerId: string,
  ramp: FillValueConfig,
  /** Resolve a stored config's field against the layer's current fields.
   *  The caller resolves the config it paints with, so the highlight pin must
   *  resolve the live record the same way before comparing: a stored field the
   *  data no longer offers would otherwise compare unequal to the resolved one
   *  and the mouseout replay would drop the value color. Identity by default —
   *  a caller with no field list has nothing to resolve. */
  resolveStored: (stored: FillValueConfig) => FillValueConfig = stored => stored,
  /** The config the highlight pin replays on mouseout: the live user intent,
   *  or the author's declared value stroke when the user has not chosen one.
   *  Without it a declared value stroke would be dropped by folium's
   *  `resetStyle` on the first hover, leaving the author's flat face under a
   *  by-value panel. */
  liveRamp: () => FillValueConfig | undefined,
  /** The live active arm the pin reads on mouseout — the caller owns the
   *  stored mode, so the pin asks for it rather than importing an intent key
   *  that does not exist yet. A mode that is not "value" returns null so a
   *  solid-mode leaf is never re-painted by a stale value pin. */
  liveMode: () => FillMode | undefined,
  /** The border width to carry through the value arm. Default `undefined`
   *  keeps the existing color-only behavior (the author's width stays in
   *  force); the border dimension passes its live width so a user-set
   *  border width survives the value-stroke write and the highlight pin. */
  weight?: number,
): void => {
  const decl: ValueFaceDecl = {
    dim: DIM.BORDER,
    face: FACE.STROKE,
    colorKey: "color",
    rider:
      weight !== undefined
        ? { key: "weight", read: () => weight }
        : null,
    walkLeaves: walkStyleLeaves,
    isValueActive: (_ui, _layerId, value) =>
      resolveStrokeMode(liveMode(), value) === "value",
    readValueConfig: () => liveRamp(),
    logLabel: "value-based stroke:",
  };
  applyValuePaint(ui, layerId, ramp, decl, resolveStored, liveRamp);
};

export { applyValueStroke, resolveStrokeMode };
