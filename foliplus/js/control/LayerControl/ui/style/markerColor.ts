// ui/style/markerColor — per-layer marker chassis color dimension.
//
// The marker chassis color is a WHOLE-LAYER choice: the user picks one hex
// (a swatch), and every awesome-markers marker leaf in the layer gets that
// chassis. There is no field, no per-category mapping, no legend — one layer,
// one chassis color. A chassis OPACITY (0-100) rides the same dimension: the
// row is [color swatch | opacity number], exactly like the icon-color row.
//
// The write is a direct Leaflet call rather than a `setStyle` face, exactly
// like the icon / icon-color dimensions: a marker's icon is `options.icon`,
// not a style slice. `FACE.MARKER_COLOR` rides the same frame coalescer and is
// a NEW face, separate from `FACE.ICON` / `FACE.ICON_COLOR` — two dimensions
// sharing one face share one (face, layerId) queue slot, so one dimension's
// trailing write would replace the other's box and swallow a frame. The
// chassis and the glyph/color are orthogonal and merge into ONE derived icon
// (a `setIcon` replaces the whole icon object, so two successive writes would
// clobber the first) — this module reads the icon + icon-color intents too and
// passes the current glyph and color into the same `buildMarkerIcon`
// construction.
//
// The Leaflet-facing half (capture / derive / apply / reset walks) lives in
// core/leaflet/markerIcon.ts; this file keeps only the intent slot, the FACE
// schedule and the panel row.
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { currentGlyph } from "./icon.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { createReplayGate } from "./replay.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { styleCapability } from "./styleCapability.js";
import { DIM } from "#core/layer/index.js";
import {
  MARKER_COLOR_PRESET_HEX,
  applyMarkerColorToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  authorMarkerColor,
  authorMarkerColorHex,
  markerColorHexOf,
  resetIconLeaves,
  resolveChassisPaint as resolveChassisPaintCore,
} from "#core/leaflet/index.js";
import { isHexColor } from "#platform/color.js";
import { withUnit } from "#platform/format.js";
import {
  bindLiveNumber,
  colorInput,
  formRow,
  inlineControls,
  numberInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import {
  type DeclaredIconFace,
  readDeclaredIcon,
  readDeclaredIconSize,
  readDeclaredMarkerColor,
  readDeclaredMarkerColorOpacity,
} from "#control/LayerControl/declaredParse.js";

/** The author-declared icon pixel size for this layer (foliplus icon_size),
 *  or undefined when the layer declares none -- the whole-icon box edge the
 *  marker construction scales to. Read off the layer so a declared size rides
 *  every re-derivation (glyph / icon-colour / chassis write) without each
 *  caller re-deriving it. */
const declaredIconSizeOf = (layer: unknown): number | undefined =>
  readDeclaredIconSize(layer).declared;

/** The author-declared icon face (foliplus icon face), or undefined when the
 *  layer declares none. A chassis write is orthogonal to the glyph / glyph
 *  colour, but it re-derives the whole icon, so it must carry the declared
 *  defaults exactly like it carries the user's intents. */
const declaredIconOf = (
  layer: unknown,
  layerId?: string,
): DeclaredIconFace | undefined => readDeclaredIcon(layer, layerId).declared;

/** The row gate: the layer must be in the registry, then its surface must
 *  declare the marker-color capability (an awesome-markers chassis carrier —
 *  a bare divIcon / L.Icon.Default img has no sprite chassis to repaint). */
const layerCanMarkerColor = (ui: LayerUI, layerId: string): boolean =>
  styleCapability(ui, layerId).dims.markerColor;

/** The chassis paint when the user has not picked one: the author's own
 *  chassis, else the author-declared foliplus marker_color, else the
 *  awesome-markers default blue. The priority chain and the hex/preset mapping
 *  live in core (`resolveChassisPaint`, `markerColorHexOf`) — the same readers
 *  the paint read uses — so this wrapper only supplies the declaration value,
 *  which the control layer owns. A panel pick wins and Reset returns here. */
const resolveChassisPaint = (layer: unknown): string =>
  resolveChassisPaintCore(layer, readDeclaredMarkerColor(layer).declared ?? null);

/** The chassis hex the author DECLARED via foliplus marker_color, or null when
 *  the layer declares nothing (or an out-of-vocabulary name, which the reader
 *  warns about and reads as not-declared). The mapping is core's
 *  `markerColorHexOf`, so the declared path and the author path cannot drift. */
const declaredMarkerColorHex = (layer: unknown): string | null =>
  markerColorHexOf(readDeclaredMarkerColor(layer).declared ?? null);

/** Apply the layer's stored chassis color + opacity to every marker leaf,
 *  re-deriving the icon in ONE construction with the current glyph and icon
 *  color. A missing intent is a no-op — a layer the user never touched keeps
 *  exactly what the author declared. */
const applyMarkerColorToLayer = (ui: LayerUI, layerId: string): void => {
  const markerColor = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY);
  if (typeof markerColor !== "string" && typeof opacity !== "number") return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // An opacity-only write still re-derives the chassis — at the AUTHOR's
  // color (the user changed only the transparency). The glyph is
  // orthogonal: a user glyph wins, else the author's own glyph name. The
  // icon color rides the same one-shot construction.
  const paint =
    typeof markerColor === "string" ? markerColor : resolveChassisPaint(layer);
  const declared = declaredIconOf(layer, layerId);
  const glyph =
    currentGlyph(ui, layerId) ??
    declared?.glyph ??
    authorGlyphNameOnLayer(layer)?.name ??
    null;
  const iconColorIntent = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const iconColor =
    typeof iconColorIntent === "string" ? iconColorIntent : declared?.color;
  applyMarkerColorToLeaves(
    layer,
    paint,
    glyph,
    iconColor,
    typeof opacity === "number" ? opacity : undefined,
    declaredIconSizeOf(layer),
  );
};
/** Write the layer's chassis color and replay the walk.
 *
 *  Scheduled with `owner: ui` for the same reason as `iconColor.ts`: the walk
 *  lands in this UI's scope, so a late failure reaches this map's observer and
 *  the reset path's `cancelStyleDimApply(..., ui)` finds the walk it drops
 *  instead of leaving it queued behind the authored restore. */
const commitMarkerColor = (ui: LayerUI, layerId: string, markerColor: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, markerColor]]);
  scheduleStyleDimApply(
    FACE.MARKER_COLOR,
    layerId,
    () => applyMarkerColorToLayer(ui, layerId),
    {
      owner: ui,
    },
  );
};
/** Write the layer's chassis opacity (0-100) and replay the walk. Stored as
 *  the integer itself — a 100 the user chose is kept (the author may have
 *  painted the chassis at a translucent alpha only via a span, and clearing
 *  on 100 would silently restore it). */
const commitMarkerColorOpacity = (
  ui: LayerUI,
  layerId: string,
  opacity: number,
): void => {
  const value = Math.round(opacity);
  if (!(value >= 0 && value <= 100)) return;
  writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR_OPACITY, value]]);
  scheduleStyleDimApply(
    FACE.MARKER_COLOR,
    layerId,
    () => applyMarkerColorToLayer(ui, layerId),
    {
      owner: ui,
    },
  );
};
/** Reset the layer's chassis color + opacity to the author's and drop the
 *  persisted entry. The authored icons come from the core capture table, never
 *  from a re-read. A walk queued by a trailing edit is cancelled before the
 *  leaves are touched. The glyph and icon color are orthogonal: resetting the
 *  chassis must NOT clear a user-set glyph or icon color. */
const resetLayerMarkerColor = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.MARKER_COLOR, INTENT.MARKER_COLOR_OPACITY]);
  cancelStyleDimApply(FACE.MARKER_COLOR, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // Re-derive with the author chassis: drop the intents, then walk with the
  // current glyph and icon color so both survive the chassis reset.
  const declared = declaredIconOf(layer, layerId);
  const glyph =
    currentGlyph(ui, layerId) ??
    declared?.glyph ??
    authorGlyphNameOnLayer(layer)?.name ??
    null;
  const iconColorIntent = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const iconColor =
    typeof iconColorIntent === "string" ? iconColorIntent : declared?.color;
  const authorName = authorMarkerColor(layer);
  if (authorName) {
    // The author declares a chassis: re-derive at the author's hex (a preset
    // name maps forward through the table; a non-preset hex is used as-is).
    // isHexColor also admits the 3-digit form, but this branch feeds a
    // chassis the swatch row shows as 6 digits, so keep the 6-digit shape.
    const authorHex =
      isHexColor(authorName) && authorName.length === 7
        ? authorName.toLowerCase()
        : ((MARKER_COLOR_PRESET_HEX as Record<string, string | undefined>)[
            authorName
          ] ?? MARKER_COLOR_PRESET_HEX.blue);
    applyMarkerColorToLeaves(
      layer,
      authorHex,
      glyph,
      iconColor,
      declaredIconSizeOf(layer),
    );
  } else {
    // No author chassis: restore the author icon, then re-apply a user glyph
    // / icon color so resetting the chassis never clears them (orthogonal).
    // The re-apply lands on the DECLARED chassis (the read-time default Reset
    // returns to), else the derived blue — never the hardcoded blue.
    resetIconLeaves(layer);
    if (glyph || typeof iconColor === "string") {
      applyMarkerColorToLeaves(
        layer,
        resolveChassisPaint(layer),
        glyph,
        iconColor,
        declaredIconSizeOf(layer),
      );
    }
  }
};

/** Attach-sweep replay for an author-declared chassis only.
 *
 *  The provenance loop in applyUserState reaches only layers the user
 *  touched; a layer whose marker_color is declared but never edited is
 *  absent from it, and only a declaration needs the extra pass. Layers with a
 *  stored intent are skipped so the sweep does not apply the same chassis
 *  twice. Mirrors replayDeclaredFill / replayDeclaredBorder. */
const declaredReplayGate = createReplayGate();

const replayDeclaredMarkerColor = (ui: LayerUI, layerId: string): void => {
  if (
    getIntent(ui, layerId, INTENT.MARKER_COLOR) !== undefined ||
    getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY) !== undefined
  ) {
    return;
  }
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  if (declaredMarkerColorHex(layer) === null) return;
  if (declaredReplayGate.has(ui, layerId)) return;
  // An author-chassis marker needs no replay (the author icon is the map
  // state); only a declared chassis with no author chassis is a read-time
  // default the paint must apply.
  if (authorMarkerColorHex(layer) === null) {
    applyMarkerColorToLeaves(
      layer,
      declaredMarkerColorHex(layer)!,
      declaredIconOf(layer, layerId)?.glyph ??
        authorGlyphNameOnLayer(layer)?.name ??
        null,
      declaredIconOf(layer, layerId)?.color,
      declaredIconSizeOf(layer),
    );
  }
  declaredReplayGate.mark(ui, layerId);
};

/** Build the marker-color row: a swatch input plus a chassis-opacity number
 *  field, on the same inline flex shell every other [color | number] style
 *  row uses (see fill.ts / border.ts / iconColor.ts). */
const buildMarkerColorRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanMarkerColor(ui, layerId)) return null;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  const current = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  // A panel pick wins; else the author's own chassis; else the
  // author-declared foliplus marker_color (the read-time default Reset
  // returns to); else the awesome-markers blue.
  const value = typeof current === "string" ? current : resolveChassisPaint(layer);
  const input = colorInput({
    value,
    ariaLabel: ui.T("style_marker_color"),
  }) as HTMLInputElement;
  const storedOpacity = getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY);
  // The row's opacity is the user intent, else the author-declared chassis
  // alpha (the read-time default Reset returns to), else 100%.
  const declaredOpacity = readDeclaredMarkerColorOpacity(
    ui.c.findLayer(layerId),
    layerId,
  ).declared;
  const opacityGroup = numberInput({
    value: typeof storedOpacity === "number" ? storedOpacity : (declaredOpacity ?? 100),
    min: 0,
    max: 100,
    step: 1,
    className: CONST.CLASSES.STYLE_MARKER_COLOR_OPACITY_NUMBER,
    ariaLabel: withUnit(ui.T("style_marker_color_opacity"), ui._("foliplus.unit_pct")),
    unitSuffix: ui._("foliplus.unit_pct"),
  });
  const opacityInput = opacityGroup.querySelector("input") as HTMLInputElement;
  const row = formRow(
    ui.T("style_marker_color"),
    inlineControls(input, opacityGroup),
    CONST.CLASSES.STYLE_MARKER_COLOR_ROW,
  );
  row.dataset.styleDim = "markerColor";
  input.addEventListener("input", () => {
    const next = input.value;
    if (!isHexColor(next)) return;
    commitMarkerColor(ui, layerId, next);
  });
  bindLiveNumber(opacityInput, {
    min: 0,
    max: 100,
    fallback: 100,
    onCommit: nextOpacity => commitMarkerColorOpacity(ui, layerId, nextOpacity),
  });
  return row;
};

/** Register marker-color as a per-layer dimension. */
const MARKER_COLOR_DIMENSION = registerDimension<{
  value?: string;
  opacity?: number;
}>({
  key: DIM.MARKER_COLOR,
  gate: layerCanMarkerColor,
  value: (ui, layerId) => {
    const markerColor = getIntent(ui, layerId, INTENT.MARKER_COLOR);
    const opacity = getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY);
    return typeof markerColor === "string" || typeof opacity === "number"
      ? {
          value: typeof markerColor === "string" ? markerColor : undefined,
          opacity: typeof opacity === "number" ? opacity : undefined,
        }
      : undefined;
  },
  row: (ui, layerId) => buildMarkerColorRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    const markerColor = patch.value;
    const opacity = patch.opacity;
    if (typeof markerColor !== "string" && typeof opacity !== "number") return;
    const keys: Array<readonly [IntentKey, unknown]> = [];
    if (typeof markerColor === "string") keys.push([INTENT.MARKER_COLOR, markerColor]);
    if (typeof opacity === "number") {
      const value = Math.round(opacity);
      if (value >= 0 && value <= 100) {
        keys.push([INTENT.MARKER_COLOR_OPACITY, value]);
      }
    }
    if (keys.length === 0) return;
    writeIntentKeys(ui, layerId, keys);
    scheduleStyleDimApply(
      FACE.MARKER_COLOR,
      layerId,
      () => applyMarkerColorToLayer(ui, layerId),
      {
        owner: ui,
      },
    );
  },
  reset: (ui, layerId) => resetLayerMarkerColor(ui, layerId),
  intentKeys: [INTENT.MARKER_COLOR, INTENT.MARKER_COLOR_OPACITY],
  contentChange: {
    kind: "frame",
    face: FACE.MARKER_COLOR,
    when: (ui, layerId) =>
      getIntent(ui, layerId, INTENT.MARKER_COLOR) !== undefined ||
      getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY) !== undefined,
    run: (ui, layerId) => applyMarkerColorToLayer(ui, layerId),
  },
});

export {
  MARKER_COLOR_DIMENSION,
  applyMarkerColorToLayer,
  buildMarkerColorRow,
  commitMarkerColor,
  commitMarkerColorOpacity,
  layerCanMarkerColor,
  replayDeclaredMarkerColor,
  resolveChassisPaint,
  resetLayerMarkerColor,
};
