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
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { CAP_TIER, DIM } from "#core/layer/index.js";
import {
  applyIconColorToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  resetIconLeaves,
} from "#core/leaflet/index.js";
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
const layerCanIconColor = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.iconColor === CAP_TIER.NATIVE;
};

/** The author's own icon color when the layer's marker icon declares one
 *  (awesome-markers paints the glyph color on the inner `<i>`; the author's inline
 *  `style.color` is the fallback the derive path reads). */
const authorIconColor = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  let found: string | null = null;
  (
    layer as unknown as { eachLayer?: (fn: (leaf: unknown) => void) => void }
  ).eachLayer?.(leaf => {
    if (found) return;
    const own = (
      leaf as {
        options?: { icon?: { options?: { iconColor?: unknown } } };
      }
    ).options?.icon?.options?.iconColor;
    if (typeof own === "string" && own) found = own;
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
  applyIconColorToLeaves(layer, color, glyph, hasOpacity ? opacityIntent : undefined);
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
    applyIconColorToLeaves(layer, authorColor, glyph);
  } else {
    // No author paint: restore the author icon, then re-apply a user glyph
    // so resetting the color never clears the glyph (orthogonal).
    resetIconLeaves(layer);
    if (glyph) {
      applyIconColorToLeaves(layer, "#ffffff", glyph);
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
  const value = typeof current === "string" ? current : (authorColor ?? "#ffffff");
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
    ariaLabel: ui.T("style_icon_color_opacity"),
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
