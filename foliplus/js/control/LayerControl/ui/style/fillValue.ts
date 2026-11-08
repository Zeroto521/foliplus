// Value-based fill rendering — the "按值着色 / Color by value" arm of the
// fill dimension.
//
// This module is now the FILL declaration over the shared by-value arm
// (valuePaint.ts): the fill face's specific surface — which slot the ramp
// color lands in (`fillColor`), which leaf walker reaches the fill carriers,
// the solid-mode `fillOpacity`, the FILL mode check, and the live fillValue
// reader — is declared here and handed to `applyValuePaint`, which walks the
// leaves and paints. All the walking / ramp / write / pin logic lives in the
// arm and is face-independent; a new by-value dimension (stroke / size /
// icon) declares its own `ValueFaceDecl` and calls the same arm.
//
// The arm's highlight pin reads the live fillValue intent and the cached
// breaks. If the config changed since the cache was built (field / method /
// classes / scheme differ), the getter returns null so the author's fill
// face stays in force — the next scheduler tick rebuilds the cache.
import { DIM } from "#core/layer/index.js";
import { FILL_MODE, type FillMode, type FillValueConfig } from "#core/layer/intent.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { FACE, walkFillLeaves } from "./styleBag.js";
import { type ValueFaceDecl, applyValuePaint } from "./valuePaint.js";

const resolveFillMode = (
  ui: LayerUI,
  layerId: string,
  value: FillValueConfig | undefined,
): FillMode =>
  getIntent(ui, layerId, INTENT.FILL_MODE) ??
  (value !== undefined ? FILL_MODE.VALUE : FILL_MODE.SOLID);

/** The fill face's declaration — the specific surface the shared arm
 *  consumes. Every value here is a fill fact; the arm body carries none. */
const FILL_FACE_DECL: ValueFaceDecl = {
  dim: DIM.FILL,
  face: FACE.FILL,
  colorKey: "fillColor",
  opacity: {
    key: "fillOpacity",
    read: (ui, layerId) => getIntent(ui, layerId, INTENT.FILL_OPACITY),
  },
  walkLeaves: walkFillLeaves,
  isValueActive: (ui, layerId, value) =>
    resolveFillMode(ui, layerId, value) === FILL_MODE.VALUE,
  readValueConfig: (ui, layerId) => getIntent(ui, layerId, INTENT.FILL_VALUE),
  logLabel: "value-based fill:",
};

/** Apply a value-based fill to one layer. This is the fill face's call
 *  through the shared arm: the arm collects, builds, writes and pins; the
 *  declaration above tells it what the fill face is. The two optional
 *  readers are the fill face's own (they default to the declaration's). */
const applyValueFill = (
  ui: LayerUI,
  layerId: string,
  value: FillValueConfig,
  /** Resolve a stored config's field against the layer's current fields. The
   *  caller resolves the config it paints with, so the arm's highlight pin
   *  must resolve the live record the same way before comparing. Identity by
   *  default — a caller with no field list has nothing to resolve. */
  resolveStored: (stored: FillValueConfig) => FillValueConfig = stored => stored,
  /** The config the highlight pin replays on mouseout: the live fillValue
   *  intent, or the author's declared value fill when the user has not
   *  chosen one. */
  liveValue: () => FillValueConfig | undefined = () =>
    FILL_FACE_DECL.readValueConfig(ui, layerId),
): void => {
  applyValuePaint(ui, layerId, value, FILL_FACE_DECL, resolveStored, liveValue);
};

export { applyValueFill, resolveFillMode };
