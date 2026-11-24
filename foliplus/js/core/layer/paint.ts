// core/layer/paint — read the paint a layer renders, one color per geometry face.
//
// `LayerAPI.getStyle` answers "what does the panel say"; this answers the
// downstream question "what color is this layer drawing". Every rule the read
// needs has one home: the color spelling in `#platform/color`, the
// awesome-markers preset table in `core/leaflet/markerColorPreset`, the chassis
// priority chain in `core/leaflet/markerIcon` (`resolveChassisPaint`), and the
// geometry predicates in `./capability` — so a paint read cannot disagree with
// the rows the panel shows.
//
// Colors are normalized to lower-case #rrggbb when they are hex; a spelling we
// cannot normalize (a named CSS colour) passes through unchanged, because that is
// what the map actually draws and re-inventing it would lie.
import { isArealStyleLeaf, isMarkerLeaf, isPathLeaf } from "./capability.js";
import { walkLeaf } from "./walkLeaf.js";
import { markerColorHexOf, resolveChassisPaint } from "#core/leaflet/index.js";
import { isHexColor, normalizeHexColor } from "#platform/color.js";

/** Which geometry face one leaf paints. */
type PaintFace = "areal" | "line" | "marker";

/** One leaf's paint. `border` is the stroke colour; a marker has no stroke. */
interface LeafPaint {
  kind: PaintFace;
  color: string;
  border: string;
  opacity: number;
}

/** One layer's paint. `kind` collapses to `mixed` when the leaves disagree;
 *  `colors` always lists every distinct primary colour (sorted, so two reads of
 *  the same tree compare equal) and `multicolor` is `colors.length > 1`. */
interface LayerPaint {
  kind: PaintFace | "mixed";
  color: string;
  border: string;
  opacity: number;
  multicolor: boolean;
  colors: string[];
}

/** Normalize a color spelling to lower-case #rrggbb when it is a hex, and pass
 *  every other spelling through unchanged. */
const hexOf = (value: unknown): string =>
  typeof value === "string" && value !== ""
    ? isHexColor(value)
      ? normalizeHexColor(value).toLowerCase()
      : value
    : "";

/** A 0..1 opacity, falling back when the leaf does not declare a usable one. */
const opacityOf = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1, Math.max(0, value))
    : fallback;

/** The areal face: the fill is primary and is paired with `fillOpacity`. A
 *  fully transparent fill leaves the stroke as the only paint, so the stroke
 *  becomes primary and pairs with the stroke's own opacity — reading the
 *  `fillOpacity` there would report an invisible layer for a drawn outline. */
const arealPaintOf = (options: Record<string, unknown>): LeafPaint => {
  const stroke = hexOf(options.color);
  const fill = hexOf(options.fillColor) || stroke;
  const fillOpacity = opacityOf(options.fillOpacity, 0.2);
  const paintsFill = options.fill !== false && fillOpacity > 0 && fill !== "";
  return paintsFill
    ? { kind: "areal", color: fill, border: stroke, opacity: fillOpacity }
    : {
        kind: "areal",
        color: stroke || fill,
        border: stroke,
        opacity: opacityOf(options.opacity, 1),
      };
};

/** The line face: one stroke colour, paired with the stroke's own `opacity`
 *  (never `fillOpacity`, which a line does not paint). */
const linePaintOf = (options: Record<string, unknown>): LeafPaint => {
  const stroke = hexOf(options.color);
  return {
    kind: "line",
    color: stroke,
    border: stroke,
    opacity: opacityOf(options.opacity, 1),
  };
};

/** The marker face: the chassis the icon paints (a preset name maps through the
 *  one preset table, a hex normalizes), paired with `markerColorOpacity`. The
 *  live icon wins; a leaf whose live icon declares no chassis falls back to the
 *  same author/declared/default chain the panel row uses. */
const markerPaintOf = (leaf: unknown): LeafPaint => {
  const icon = (leaf as { options?: { icon?: { options?: Record<string, unknown> } } })
    .options?.icon;
  const color =
    markerColorHexOf(icon?.options?.markerColor) ??
    resolveChassisPaint(leaf as L.Layer);
  const percent = icon?.options?.markerColorOpacity;
  const opacity =
    typeof percent === "number" && Number.isFinite(percent) ? percent / 100 : 1;
  return { kind: "marker", color, border: "", opacity: opacityOf(opacity, 1) };
};

/** The paint of one leaf, or null for a leaf that paints no color carrier
 *  (a tile layer, a grid layer, a non-style node). */
const leafPaintOf = (leaf: unknown): LeafPaint | null => {
  const options = ((leaf as { options?: Record<string, unknown> }).options ??
    {}) as Record<string, unknown>;
  if (isMarkerLeaf(leaf)) return markerPaintOf(leaf);
  if (isArealStyleLeaf(leaf)) return arealPaintOf(options);
  if (isPathLeaf(leaf)) return linePaintOf(options);
  return null;
};

/** Per-leaf paint, keyed by leaf identity — the per-leaf path for a caller that
 *  needs every feature rather than the layer summary. */
const readLeafPaints = (layer: unknown): Map<unknown, LeafPaint> => {
  const paints = new Map<unknown, LeafPaint>();
  walkLeaf(layer, leaf => {
    const paint = leafPaintOf(leaf);
    if (paint) paints.set(leaf, paint);
  });
  return paints;
};

/** Read the paint a layer renders: the primary colour, the stroke colour, the
 *  opacity paired with the primary colour, the face (or `mixed`), and the
 *  distinct colour set (sorted) with `multicolor`. An empty tree answers an
 *  empty paint rather than inventing a colour. */
const readLayerPaint = (layer: unknown): LayerPaint => {
  const paints = [...readLeafPaints(layer).values()];
  const colors = [...new Set(paints.map(p => p.color).filter(Boolean))].sort();
  const primary = paints.find(p => p.color !== "") ?? paints[0];
  const faces = new Set(paints.map(p => p.kind));
  const [first] = paints;
  return {
    kind: faces.size === 1 && first ? first.kind : "mixed",
    color: primary?.color ?? "",
    border: paints.find(p => p.border !== "")?.border ?? "",
    opacity: primary?.opacity ?? 1,
    multicolor: colors.length > 1,
    colors,
  };
};

export { readLayerPaint, readLeafPaints };
export type { LayerPaint, LeafPaint, PaintFace };
