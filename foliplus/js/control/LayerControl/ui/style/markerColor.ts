// ui/style/markerColor — per-layer marker chassis color dimension.
//
// The marker chassis color is a WHOLE-LAYER choice: the user picks one of
// the awesome-markers preset enum names (the sprite background), and every
// awesome-markers marker leaf in the layer gets that chassis. There is no
// field, no per-category mapping, no legend — one layer, one chassis color.
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
import { INTENT, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { currentGlyph } from "./icon.js";
import {
  capabilityGate,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { DIM, MARKER_COLOR_PRESETS } from "#core/layer/index.js";
import {
  applyMarkerColorToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  resetIconLeaves,
} from "#core/leaflet/index.js";
import { dropdownSurface } from "#platform/fullscreen.js";
import { createDropdown, formRow, inlineControls, selectInput } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** The row gate: the layer must be in the registry, then its surface must
 *  declare the marker-color capability (an awesome-markers chassis carrier —
 *  a bare divIcon / L.Icon.Default img has no sprite chassis to repaint). */
const layerCanMarkerColor = capabilityGate("markerColor", "native");

/** The author's own chassis color when the layer's marker icon declares one
 *  (awesome-markers sets `options.markerColor` on the icon — the preset enum
 *  name the sprite class is built from). */
const authorMarkerColor = (layer: unknown): string | null => {
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

/** Apply the layer's stored chassis color to every marker leaf, re-deriving
 *  the icon in ONE construction with the current glyph and icon color. A
 *  missing intent is a no-op — a layer the user never touched keeps exactly
 *  what the author declared. */
const applyMarkerColorToLayer = (ui: LayerUI, layerId: string): void => {
  const markerColor = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  if (typeof markerColor !== "string") return;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // The glyph is orthogonal: a user glyph wins, else the author's own
  // glyph name. The icon color rides the same one-shot construction.
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  const iconColor = getIntent(ui, layerId, INTENT.ICON_COLOR);
  applyMarkerColorToLeaves(
    layer,
    markerColor,
    glyph,
    typeof iconColor === "string" ? iconColor : undefined,
  );
};
/** Write the layer's chassis color and replay the walk. */
const commitMarkerColor = (ui: LayerUI, layerId: string, markerColor: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, markerColor]]);
  scheduleStyleDimApply(FACE.MARKER_COLOR, layerId, () =>
    applyMarkerColorToLayer(ui, layerId),
  );
};
/** Reset the layer's chassis color to the author's and drop the persisted
 *  entry. The authored icons come from the core capture table, never from a
 *  re-read. A walk queued by a trailing edit is cancelled before the leaves
 *  are touched. The glyph and icon color are orthogonal: resetting the
 *  chassis must NOT clear a user-set glyph or icon color. */
const resetLayerMarkerColor = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
  resetIntentKeys(ui, layerId, [INTENT.MARKER_COLOR]);
  cancelStyleDimApply(FACE.MARKER_COLOR, layerId, ui);
  const layer = ui.c.findLayer(layerId);
  if (!layer) return;
  // Re-derive with the author chassis: drop the intent, then walk with the
  // current glyph and icon color so both survive the chassis reset.
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  const iconColor = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const authorColor = authorMarkerColor(layer);
  if (authorColor) {
    applyMarkerColorToLeaves(
      layer,
      authorColor,
      glyph,
      typeof iconColor === "string" ? iconColor : undefined,
    );
  } else {
    // No author chassis: restore the author icon, then re-apply a user glyph
    // / icon color so resetting the chassis never clears them (orthogonal).
    resetIconLeaves(layer);
    if (glyph || typeof iconColor === "string") {
      applyMarkerColorToLeaves(
        layer,
        "blue",
        glyph,
        typeof iconColor === "string" ? iconColor : undefined,
      );
    }
  }
};

/** Build the marker-color row: a preset select. */
const buildMarkerColorRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanMarkerColor(ui, layerId)) return null;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  const current = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  const authorColor = authorMarkerColor(layer);
  const value = typeof current === "string" ? current : (authorColor ?? "blue");
  const select = selectInput({
    value,
    ariaLabel: ui.T("style_marker_color"),
    options: MARKER_COLOR_PRESETS.map(name => ({
      value: name,
      label: name,
    })),
  }) as HTMLSelectElement;
  // The visible picker is the shared dropdown; the select stays mounted
  // (hidden) as the value/change bridge the panel delegates on, so Escape /
  // layering / portal semantics match every other style dropdown.
  const dropdown = createDropdown({
    nativeSelect: select,
    ariaLabel: ui.T("style_marker_color"),
    ...dropdownSurface(ui.c.map.getContainer()),
  });
  const row = formRow(
    ui.T("style_marker_color"),
    inlineControls(dropdown.element),
    CONST.CLASSES.STYLE_MARKER_COLOR_ROW,
  );
  select.addEventListener("change", () => {
    commitMarkerColor(ui, layerId, select.value);
  });
  return row;
};

/** Register marker-color as a per-layer dimension. */
const MARKER_COLOR_DIMENSION = registerDimension<{ value?: string }>({
  key: DIM.MARKER_COLOR,
  gate: layerCanMarkerColor,
  value: (ui, layerId) => {
    const markerColor = getIntent(ui, layerId, INTENT.MARKER_COLOR);
    return typeof markerColor === "string" ? { value: markerColor } : undefined;
  },
  row: (ui, layerId) => buildMarkerColorRow(ui, layerId) as HTMLElement,
  write: (ui, layerId, patch) => {
    const markerColor = patch.value;
    if (typeof markerColor !== "string") return;
    writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, markerColor]]);
    scheduleStyleDimApply(FACE.MARKER_COLOR, layerId, () =>
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
    face: FACE.MARKER_COLOR,
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
