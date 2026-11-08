// LayerControl UI — per-layer marker colour dimension (DOM/panel layer).
//
// The marker colour is a WHOLE-LAYER choice: the user picks one colour from
// the swatch, and every awesome-markers marker leaf in the layer gets that
// colour (the awesome-markers `markerColor` face). There is no field, no
// per-category mapping, no legend — one layer, one colour.
//
// The write is a direct Leaflet call rather than a `setStyle` face, exactly
// like the icon dimension: a marker's icon is `options.icon`, not a style
// slice. `FACE.ICON` rides the same frame coalescer as `FACE.SIZE` (both are
// non-`setStyle` faces), so a burst of edits lands one walk. The colour and
// the glyph are orthogonal and merge into ONE derived icon (a `setIcon`
// replaces the whole icon object, so two successive writes would clobber the
// first) — this module reads the icon intent too and passes the current glyph
// into the same `buildMarkerIcon` construction.
//
// The Leaflet-facing half (capture / derive / apply / reset walks) lives in
// core/leaflet/markerIcon.ts; this file keeps only the intent slot, the FACE
// schedule and the panel row.
import { CAP_TIER, DIM } from "#core/layer/index.js";
import { applyMarkerColorToLeaves, resetIconLeaves } from "#core/leaflet/markerIcon.js";
import { colorInput } from "#ui/form.js";
import { formRow } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { currentGlyph } from "./icon.js";
import { registerDimension, resetIntentKeys, writeIntentKeys } from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";

/** The row gate: the layer must be in the registry, then its surface must
 *  declare the marker-colour capability (an awesome-markers carrier — a plain
 *  divIcon / iconUrl has no markerColor face to write). */
const layerCanMarkerColor = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.markerColor === CAP_TIER.NATIVE;
};

/** The author's own marker colour when the layer's marker icon declares one
 *  (awesome-markers paints `markerColor` on the chassis; the author's inline
 *  `style.color` is the fallback the derive path reads). */
const authorMarkerColor = (ui: LayerUI, layerId: string): string | null => {
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  let found: string | null = null;
  (
    layer as unknown as { eachLayer?: (fn: (leaf: unknown) => void) => void }
  ).eachLayer?.(leaf => {
    if (found) return;
    const own = (
      leaf as {
        options?: { icon?: { options?: { markerColor?: unknown } } };
      }
    ).options?.icon?.options?.markerColor;
    if (typeof own === "string" && own) found = own;
  });
  return found;
};

/** Apply the layer's stored colour to every marker leaf, re-deriving the icon
 *  in ONE construction with the current glyph. A missing intent is a no-op —
 *  a layer the user never touched keeps exactly what the author declared. */
const applyMarkerColorToLayer = (ui: LayerUI, layerId: string): void => {
  const color = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  if (typeof color !== "string") return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  const glyph = currentGlyph(ui, layerId);
  applyMarkerColorToLeaves(layer, color, glyph);
};
/** Write the layer's colour and replay the walk. */
const commitMarkerColor = (ui: LayerUI, layerId: string, color: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, color]]);
  scheduleStyleDimApply(FACE.ICON, layerId, () => applyMarkerColorToLayer(ui, layerId));
};
/** Reset the layer's marker colour to the author's paint and drop the
 *  persisted entry. The authored icons come from the core capture table, never
 *  from a re-read — a re-read would restore the user's own choice, and a layer
 *  that never wrote has nothing to restore anyway. A walk queued by a trailing
 *  edit is cancelled before the leaves are touched. The glyph is orthogonal:
 *  resetting the colour must NOT clear a user-set glyph. */
const resetLayerMarkerColor = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.MARKER_COLOR]);
  cancelStyleDimApply(FACE.ICON, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // Re-derive with the author paint: drop the colour intent, then walk with
  // the current glyph so the glyph survives the colour reset.
  const glyph = currentGlyph(ui, layerId);
  const authorColor = authorMarkerColor(ui, layerId);
  if (authorColor) {
    applyMarkerColorToLeaves(layer, authorColor, glyph);
  } else {
    resetIconLeaves(layer);
  }
};

/** Build the marker-colour row: a swatch input. */
const buildMarkerColorRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanMarkerColor(ui, layerId)) return null;
  const current = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  const authorColor = authorMarkerColor(ui, layerId);
  const value = typeof current === "string" ? current : (authorColor ?? "#ffffff");
  const input = colorInput({
    value,
    ariaLabel: ui.T("style_marker_color"),
  }) as HTMLInputElement;
  const row = formRow(
    ui.T("style_marker_color"),
    input,
    CONST.CLASSES.STYLE_MARKER_COLOR_ROW,
  );
  input.addEventListener("input", () => {
    const next = input.value;
    if (!/^#[0-9a-f]{6}$/i.test(next)) return;
    commitMarkerColor(ui, layerId, next);
  });
  return row;
};

/** Register marker-colour as a per-layer dimension. */
const MARKER_COLOR_DIMENSION = registerDimension<{ value?: string }>({
  key: DIM.MARKER_COLOR,
  gate: layerCanMarkerColor,
  value: (ui, layerId) => {
    const color = getIntent(ui, layerId, INTENT.MARKER_COLOR);
    return typeof color === "string" ? { value: color } : undefined;
  },
  row: (ui, layerId) => buildMarkerColorRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    const color = patch.value;
    if (typeof color !== "string") return;
    writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, color]]);
    scheduleStyleDimApply(FACE.ICON, layerId, () =>
      applyMarkerColorToLayer(ui, layerId),
    );
  },
  reset: (ui, layerId) => resetLayerMarkerColor(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanMarkerColor(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.MARKER_COLOR) ? "user" : "author";
  },
  contentChange: {
    kind: "frame",
    face: FACE.ICON,
    when: (ui, layerId) => getIntent(ui, layerId, INTENT.MARKER_COLOR) !== undefined,
    run: (ui, layerId) => applyMarkerColorToLayer(ui, layerId),
  },
});

export {
  MARKER_COLOR_DIMENSION,
  applyMarkerColorToLayer,
  buildMarkerColorRow,
  commitMarkerColor,
  layerCanMarkerColor,
  resetLayerMarkerColor,
};
