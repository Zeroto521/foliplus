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
import {
  capabilityGate,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { FACE, cancelStyleDimApply, scheduleStyleDimApply } from "./styleBag.js";
import { DIM, walkLeaf } from "#core/layer/index.js";
import {
  MARKER_COLOR_PRESET_HEX,
  applyMarkerColorToLeaves,
  authorGlyphName as authorGlyphNameOnLayer,
  authorIconOf,
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
 *  declare the marker-color capability (an awesome-markers chassis carrier —
 *  a bare divIcon / L.Icon.Default img has no sprite chassis to repaint). */
const layerCanMarkerColor = capabilityGate("markerColor", "native");

/** The author's own chassis preset for the layer, read with the SAME walk the
 *  capability gate uses (walkLeaf — a nested group is descended, not read one
 *  level). The row and the gate must agree on the same tree: the bug this
 *  closes was a one-level read that answered "no preset" for a nested group
 *  while the gate admitted it and the map drew the author's chassis.
 *  First painted leaf wins (informational — the row shows one value for the
 *  whole layer; it is not a write intent, the write applies to every leaf). */
const authorMarkerColor = (layer: unknown): string | null => {
  let found: string | null = null;
  walkLeaf(layer, leaf => {
    if (found) return;
    const icon = authorIconOf(leaf);
    if (!icon) return;
    const own = (
      icon as {
        options?: { markerColor?: unknown };
      }
    ).options?.markerColor;
    if (typeof own === "string" && own) found = own;
  });
  return found;
};

/** The author's chassis hex, or the default blue when the author declares
 *  nothing (awesome-markers defaults to blue). A non-preset author value (a
 *  hex the author painted directly) is used as-is; a preset name is mapped
 *  forward through the preset table. */
const authorMarkerColorHex = (layer: unknown): string => {
  const author = authorMarkerColor(layer);
  if (!author) return MARKER_COLOR_PRESET_HEX.blue;
  if (/^#[0-9a-f]{6}$/i.test(author)) return author.toLowerCase();
  const mapped = (MARKER_COLOR_PRESET_HEX as Record<string, string | undefined>)[
    author
  ];
  return mapped ?? MARKER_COLOR_PRESET_HEX.blue;
};

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
    typeof markerColor === "string" ? markerColor : authorMarkerColorHex(layer);
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  const iconColor = getIntent(ui, layerId, INTENT.ICON_COLOR);
  applyMarkerColorToLeaves(
    layer,
    paint,
    glyph,
    typeof iconColor === "string" ? iconColor : undefined,
    typeof opacity === "number" ? opacity : undefined,
  );
};
/** Write the layer's chassis color and replay the walk. */
const commitMarkerColor = (ui: LayerUI, layerId: string, markerColor: string): void => {
  writeIntentKeys(ui, layerId, [[INTENT.MARKER_COLOR, markerColor]]);
  scheduleStyleDimApply(FACE.MARKER_COLOR, layerId, () =>
    applyMarkerColorToLayer(ui, layerId),
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
  scheduleStyleDimApply(FACE.MARKER_COLOR, layerId, () =>
    applyMarkerColorToLayer(ui, layerId),
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
  const glyph =
    currentGlyph(ui, layerId) ?? authorGlyphNameOnLayer(layer)?.name ?? null;
  const iconColor = getIntent(ui, layerId, INTENT.ICON_COLOR);
  const authorName = authorMarkerColor(layer);
  if (authorName) {
    // The author declares a chassis: re-derive at the author's hex (a preset
    // name maps forward through the table; a non-preset hex is used as-is).
    const authorHex = /^#[0-9a-f]{6}$/i.test(authorName)
      ? authorName.toLowerCase()
      : ((MARKER_COLOR_PRESET_HEX as Record<string, string | undefined>)[authorName] ??
        MARKER_COLOR_PRESET_HEX.blue);
    applyMarkerColorToLeaves(
      layer,
      authorHex,
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
        MARKER_COLOR_PRESET_HEX.blue,
        glyph,
        typeof iconColor === "string" ? iconColor : undefined,
      );
    }
  }
};

/** Build the marker-color row: a swatch input plus a chassis-opacity number
 *  field, on the same inline flex shell every other [color | number] style
 *  row uses (see fill.ts / border.ts / iconColor.ts). */
const buildMarkerColorRow = (ui: LayerUI, layerId: string): HTMLElement | null => {
  if (!layerCanMarkerColor(ui, layerId)) return null;
  const layer = ui.c.findLayer(layerId);
  if (!layer) return null;
  const current = getIntent(ui, layerId, INTENT.MARKER_COLOR);
  const value = typeof current === "string" ? current : authorMarkerColorHex(layer);
  const input = colorInput({
    value,
    ariaLabel: ui.T("style_marker_color"),
  }) as HTMLInputElement;
  const storedOpacity = getIntent(ui, layerId, INTENT.MARKER_COLOR_OPACITY);
  const opacityGroup = numberInput({
    value: typeof storedOpacity === "number" ? storedOpacity : 100,
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
  input.addEventListener("input", () => {
    const next = input.value;
    if (!/^#[0-9a-f]{6}$/i.test(next)) return;
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
    scheduleStyleDimApply(FACE.MARKER_COLOR, layerId, () =>
      applyMarkerColorToLayer(ui, layerId),
    );
  },
  reset: (ui, layerId) => resetLayerMarkerColor(ui, layerId),
  valueSource: (ui, layerId) => {
    if (!layerCanMarkerColor(ui, layerId)) return "none";
    return ui.intentStore.isUserSet(layerId, INTENT.MARKER_COLOR) ||
      ui.intentStore.isUserSet(layerId, INTENT.MARKER_COLOR_OPACITY)
      ? "user"
      : "author";
  },
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
  resetLayerMarkerColor,
};
