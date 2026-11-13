// ui/style/iconColor — per-layer icon color dimension.
//
// The icon color is a WHOLE-LAYER choice: the user picks one color from
// the swatch, and every awesome-markers marker leaf in the layer gets that
// color (the glyph color face). There is no field, no
// per-category mapping, no legend — one layer, one color.
//
// The write is a direct Leaflet call rather than a `setStyle` face, exactly
// like the icon dimension: a marker's icon is `options.icon`, not a style
// slice. `FACE.ICON_COLOR` rides the same frame coalescer as `FACE.SIZE` (both are
// non-`setStyle` faces), so a burst of edits lands one walk. The color and
// the glyph are orthogonal and merge into ONE derived icon (a `setIcon`
// replaces the whole icon object, so two successive writes would clobber the
// first) — this module reads the icon intent too and passes the current glyph
// into the same `buildMarkerIcon` construction.
//
// The Leaflet-facing half (capture / derive / apply / reset walks) lives in
// core/leaflet/markerIcon.ts; this file keeps only the intent slot, the FACE
// schedule and the panel row.
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { currentGlyph } from "./icon.js";
import {
  capabilityGate,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { DIM, walkLeaf } from "#core/layer/index.js";
import {
  applyIconColorToLeaves,
  authorGlyphColorOf,
  authorGlyphName as authorGlyphNameOnLayer,
  authorIconOf,
  coerceGlyphPrefix,
  parseColorAlpha,
  resetIconLeaves,
} from "#core/leaflet/index.js";
import { withUnit } from "#platform/format.js";
import {
  bindLiveNumber,
  colorInput,
  formRow,
  inlineControls,
  numberInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** The row gate: the layer must be in the registry, then its surface must
 *  declare the icon-color capability (an awesome-markers carrier — a plain
 *  divIcon / iconUrl has no glyph-color face to write). */
const layerCanIconColor = capabilityGate("iconColor", "native");

/** The author's own glyph paint for the layer, read with the SAME walk the
 *  capability gate uses (walkLeaf — a nested group is descended, not read one
 *  level) and the SAME read the derive uses (authorGlyphColorOf: the inner
 *  <i> inline color first, then the declared iconColor option). The row and
 *  the derive must agree on what the map actually paints — the bug this
 *  closes was a one-level read that missed an inline-painted custom icon and
 *  a nested group, showing a default while the map drew the author's paint.
 *  First painted leaf wins (informational — the row shows one value for the
 *  whole layer, the same first-hit the write path uses). */
const authorIconColor = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  let found: string | null = null;
  walkLeaf(layer, leaf => {
    if (found) return;
    // Read the CAPTURED author icon, never the live one: after a write the
    // live options.icon is the user's derived icon, so a live read would
    // show the user's paint as the author's. The captured icon is what
    // reset restores, so the row and reset agree.
    const icon = authorIconOf(leaf);
    const paint = authorGlyphColorOf(icon);
    if (paint) found = paint;
  });
  return found;
};

/** Apply the layer's stored color to every marker leaf, re-deriving the icon
 *  in ONE construction with the current glyph. A missing intent is a no-op —
 *  a layer the user never touched keeps exactly what the author declared. */
const applyIconColorToLayer = (ui: LayerUI, layerId: string): void => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  const colorIntent = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const opacityIntent = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
  const hasColor = typeof colorIntent === "string";
  const hasOpacity = typeof opacityIntent === "number";
  // A missing intent is a no-op — a layer the user never touched keeps
  // exactly what the author declared.
  if (!hasColor && !hasOpacity) return;
  // The glyph is orthogonal: a user glyph wins, else the author's own
  // glyph name (the core falls back to the author icon's inner glyph), so a
  // color write never forces a glyph the author never drew.
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  // The color: the user's, else the author's own paint (an opacity-only
  // write must keep the author's color and only change the alpha), else
  // white — the same default the derive path uses.
  const authorColor = authorIconColor(ui, layerId);
  const color = hasColor ? colorIntent : (authorColor ?? "#ffffff");
  applyIconColorToLeaves(
    layer,
    color,
    glyph,
    hasOpacity ? opacityIntent : undefined,
    coerceGlyphPrefix(ui.config.icon_prefix ?? undefined),
  );
};
/** Write the layer's color and replay the walk. */
const commitIconColor = (ui: LayerUI, layerId: string, color: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.ICON_COLOR, color]]);
  scheduleStyleDimApply(FACE.ICON_COLOR, layerId, () =>
    applyIconColorToLayer(ui, layerId),
  );
};
/** Write the layer's glyph opacity (0-100) and replay the walk. Stored as
 *  the integer itself — a 100 the user chose is kept, because the author may
 *  have painted a translucent alpha and clearing on 100 would silently
 *  restore it. */
const commitIconColorOpacity = (
  ui: LayerUI,
  layerId: string,
  opacity: number,
): void => {
  const value = Math.round(opacity);
  if (!(value >= 0 && value <= 100)) return;
  writeIntentKeys(ui, layerId, [[INTENT.ICON_COLOR_OPACITY, value]]);
  scheduleStyleDimApply(FACE.ICON_COLOR, layerId, () =>
    applyIconColorToLayer(ui, layerId),
  );
};
/** Reset the layer's icon color to the author's paint and drop the
 *  persisted entry. The authored icons come from the core capture table, never
 *  from a re-read — a re-read would restore the user's own choice, and a layer
 *  that never wrote has nothing to restore anyway. A walk queued by a trailing
 *  edit is cancelled before the leaves are touched. The glyph is orthogonal:
 *  resetting the color must NOT clear a user-set glyph. */
const resetLayerIconColor = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.ICON_COLOR, INTENT.ICON_COLOR_OPACITY]);
  cancelStyleDimApply(FACE.ICON_COLOR, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // Re-derive with the author paint: drop both intents, then walk with the
  // current glyph so the glyph survives the color reset. The derive parses
  // the author's own alpha when the color is author-derived (no user
  // opacity), so an author paint that is translucent stays translucent.
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  const authorColor = authorIconColor(ui, layerId);
  if (authorColor) {
    // Re-derive with the author paint and the current glyph — color and
    // glyph never split across two writes.
    applyIconColorToLeaves(
      layer,
      authorColor,
      glyph,
      undefined,
      coerceGlyphPrefix(ui.config.icon_prefix ?? undefined),
    );
  } else {
    // No author paint: restore the author icon, then re-apply a user glyph
    // so resetting the color never clears the glyph (orthogonal).
    resetIconLeaves(layer);
    if (glyph) {
      applyIconColorToLeaves(
        layer,
        "#ffffff",
        glyph,
        undefined,
        coerceGlyphPrefix(ui.config.icon_prefix ?? undefined),
      );
    }
  }
};

/** Build the icon-color row: a swatch input plus a glyph-opacity number
 *  field, on the same inline flex shell every other [color | number] style
 *  row uses (see fill.ts / border.ts). */
const buildIconColorRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanIconColor(ui, layerId)) return null;
  const current = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const authorColor = authorIconColor(ui, layerId);
  // The author's paint can be an rgb() string (a browser normalizes
  // an inline style.color to rgb form); an <input type=color> only holds
  // a #rrggbb, so normalise the author paint to hex before it reaches the
  // input. The derive consumes the same raw paint fine — rgb is a valid
  // CSS color — so only the row needs this conversion.
  const authorHex = authorColor
    ? (parseColorAlpha(authorColor)?.hex ?? authorColor)
    : null;
  const value = typeof current === "string" ? current : (authorHex ?? "#ffffff");
  const input = colorInput({
    value,
    ariaLabel: ui.T("style_icon_color"),
  }) as HTMLInputElement;
  const storedOpacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
  const opacityInput = numberInput({
    value: typeof storedOpacity === "number" ? storedOpacity : 100,
    min: 0,
    max: 100,
    step: 1,
    className: CONST.CLASSES.STYLE_ICON_COLOR_OPACITY_NUMBER,
    ariaLabel: withUnit(ui.T("style_icon_color_opacity"), ui._("foliplus.unit_pct")),
  }) as HTMLInputElement;
  const row = formRow(
    ui.T("style_icon_color"),
    inlineControls(input, opacityInput),
    CONST.CLASSES.STYLE_ICON_COLOR_ROW,
  );
  input.addEventListener("input", () => {
    const next = input.value;
    if (!/^#[0-9a-f]{6}$/i.test(next)) return;
    commitIconColor(ui, layerId, next);
  });
  bindLiveNumber(opacityInput, {
    min: 0,
    max: 100,
    fallback: 100,
    onCommit: nextOpacity => commitIconColorOpacity(ui, layerId, nextOpacity),
  });
  return row;
};

/** Register icon-color as a per-layer dimension. */
const ICON_COLOR_DIMENSION = registerDimension<{
  value?: string;
  opacity?: number;
}>({
  key: DIM.ICON_COLOR,
  gate: layerCanIconColor,
  value: (ui, layerId) => {
    const color = getIntent(ui, layerId, INTENT.ICON_COLOR);
    const opacity = getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY);
    return typeof color === "string" || typeof opacity === "number"
      ? {
          value: typeof color === "string" ? color : undefined,
          opacity: typeof opacity === "number" ? opacity : undefined,
        }
      : undefined;
  },
  row: (ui, layerId) => buildIconColorRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    const color = patch.value;
    const opacity = patch.opacity;
    if (typeof color !== "string" && typeof opacity !== "number") return;
    const keys: Array<readonly [IntentKey, unknown]> = [];
    if (typeof color === "string") keys.push([INTENT.ICON_COLOR, color]);
    if (typeof opacity === "number") {
      const value = Math.round(opacity);
      if (value >= 0 && value <= 100) {
        keys.push([INTENT.ICON_COLOR_OPACITY, value]);
      }
    }
    if (keys.length === 0) return;
    writeIntentKeys(ui, layerId, keys);
    scheduleStyleDimApply(FACE.ICON_COLOR, layerId, () =>
      applyIconColorToLayer(ui, layerId),
    );
  },
  reset: (ui, layerId) => resetLayerIconColor(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanIconColor(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.ICON_COLOR) ||
      ui.intentStore.isUserSet(layerId, INTENT.ICON_COLOR_OPACITY)
      ? "user"
      : "author";
  },
  contentChange: {
    kind: "frame",
    face: FACE.ICON_COLOR,
    when: (ui, layerId) =>
      getIntent(ui, layerId, INTENT.ICON_COLOR) !== undefined ||
      getIntent(ui, layerId, INTENT.ICON_COLOR_OPACITY) !== undefined,
    run: (ui, layerId) => applyIconColorToLayer(ui, layerId),
  },
});

export {
  ICON_COLOR_DIMENSION,
  applyIconColorToLayer,
  buildIconColorRow,
  commitIconColor,
  commitIconColorOpacity,
  layerCanIconColor,
  resetLayerIconColor,
};
