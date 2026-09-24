// Fill colour row — the ⚙︎ drawer's "Layer" section fill swatch.
//
// A self-managed LayerControl dimension (like label, not like opacity /
// zoom range): the value lives in `ui.fillColorMap`, is persisted under
// `layerState.fillColor`, and reaches the map by walking `eachLayer` and
// calling `setStyle` on every leaf that owns one. The dimension is not part
// of the executor's visible/opacity/zoomRange family; the write goes
// straight to the layer because `setStyle` is a direct Leaflet API call,
// not a projection of a stored intent.
//
// Gate (§5.4 honest degradation): only layers whose surface resolves to a
// pane carrier for BOTH opacity and zoom range get a fill row — those are
// the vector shapes (Polygon, Polyline, Circle, Rectangle, GeoJSON) whose
// leaves genuinely expose `setStyle`. Canvas layers (heatmap / measure) and
// third-party delegated drawers are excluded by construction; base maps,
// MarkerCluster, GridLayer, and ImageOverlay fall out of the capability
// check.
//
// UI chrome: shared `form.colorInput` + `bindLiveColor`, the same recipe as
// the HeatmapControl border row and the annotation label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label colour has it).
import { dom } from "#common/dom.js";
import {
  bindLiveColor,
  colorInput as formColorInput,
  normalizeHexColor,
} from "#common/form.js";
import * as CONST from "../../const.js";
import type { LayerUI } from "../index.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";

/** Default paint the swatch shows when no fill has been committed yet.
 *  Matches Leaflet's own `fillColor` default, so the first write the user
 *  makes lands at the layer's authored default rather than jumping to a
 *  different colour — a change to the swatch should never *be* a jump to a
 *  value the layer already carries. */
const FILL_COLOR_DEFAULT = "#000000";

/** A node with a runtime style-setter — the honest fill carrier. Vector
 *  leaves (Path subclasses: Polygon, Polyline, Circle, CircleMarker,
 *  Rectangle) all have one; a LayerGroup does not (it delegates). */
type StyleCarrier = L.Layer & {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
  options?: { fillColor?: string };
};

/** Whether the layer's surface can honestly carry a fill write. Requires
 *  the surface to resolve to a pane carrier for BOTH opacity and zoom range
 *  — that is exactly the vector-shape population. Anything else falls out:
 *    - `layerInfo.canvas` — callback-only canvas layers (heatmap / measure)
 *      have no `eachLayer` to walk, so a `setStyle` would silently no-op.
 *    - `layerInfo.styleSetters` — third-party delegated drawers own their
 *      style write; this row would fight for the same visual axis.
 *    - `capabilities.opacity === "native"` — GridLayer / ImageOverlay paint
 *      through native options, not through `setStyle`.
 *    - `capabilities.opacity === "none"` — MarkerCluster and the "no
 *      content panes" surface have no honest write target.
 *
 *  Requiring `zoomRange !== "none"` too is the same test from the other
 *  side: any surface whose `opacity` resolves to `"pane"` but whose
 *  `zoomRange` does not is a solid-color basemap, which owns a single
 *  background pane rather than vector shapes and has no `fill` axis at
 *  all. The double check reads the capability honestly rather than
 *  special-casing the basemap id. */
const layerCanFill = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  if (li.canvas) return false;
  if (li.styleSetters) return false;
  const caps = ui.m.surfaceFor(li).capabilities;
  return caps.opacity === "pane" && caps.zoomRange === "pane";
};

/** The layer's authored base style, captured on the layer's first fill
 *  write and never re-read. Same recipe as `authorOpacityBase` in
 *  ui/apply.ts: the slider is a multiplier over the author's value, so the
 *  base is read once at first write and the value in front of us on the
 *  next write is the *last write*, not the author's.
 *
 *  Keyed by `layer` identity, not by layer id, so a re-registration of the
 *  same id keeps its base across the swap (the executor relies on the same
 *  invariant for the opacity base). WeakMap so the entry disappears when
 *  the layer leaves the map, no explicit cleanup needed.
 *
 *  Per-leaf, because a GeoJSON layer's features can each declare their own
 *  style — one layer-wide base would erase the author's per-feature choice
 *  on reset. */
const authorFillBase = new WeakMap<StyleCarrier, { fillColor: string | null }>();

const captureBase = (node: StyleCarrier): { fillColor: string | null } => {
  const existing = authorFillBase.get(node);
  if (existing) return existing;
  const base = { fillColor: node.options?.fillColor ?? null };
  authorFillBase.set(node, base);
  return base;
};

/** Commit one fill colour to the layer. Walks the layer tree and calls
 *  `setStyle({fillColor})` on every leaf that has a `setStyle`.
 *  A node without a setter is skipped silently — that is the §5.4 rule:
 *  when no honest write exists, do not persist one (the caller already
 *  wrote the value to storage, so we simply do not touch the layer here).
 *
 *  Only `fillColor` moves with this row; the author's `fillOpacity` stays
 *  untouched so a hollow polygon keeps its hollow. Reset restores the
 *  captured base (see {@link resetLayerFill}).
 *
 *  Kept separate from the persistence plumbing (`commitFillColor`) so the
 *  walk is unit-testable without a storage timer. */
const applyFillToLayer = (ui: LayerUI, layerId: string, color: string): void => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
  const walk = (node: StyleCarrier): void => {
    if (typeof node.setStyle === "function") {
      captureBase(node);
      node.setStyle({ fillColor: color });
    } else if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
    }
  };
  walk(layer);
};

/** Write the colour into the map, persist it, and mark the dimension as
 *  user-owned so it survives a reload. Only writes when the value actually
 *  moved — a colour-picker drag revisits every step, and each pass is a
 *  sweep over every feature of the layer.
 *
 *  Called from `bindLiveColor`, so `color` is a raw `input.value` and is
 *  normalised to 6-digit lowercase hex before landing in storage — the
 *  same rule the annotation label colour applies. */
const commitFillColor = (ui: LayerUI, layerId: string, rawColor: string): void => {
  const color = normalizeHexColor(rawColor);
  if (ui.fillColorMap[layerId] === color) return;
  ui.fillColorMap[layerId] = color;
  markOverride(ui, layerId, "fillColor");
  saveState(ui);
  applyFillToLayer(ui, layerId, color);
};

/** Reset one layer's fill to its authored value and drop its persisted
 *  entry. "Authored" means the base captured on first write — the same
 *  base-capture recipe opacity uses: `setStyle` mutates `options` in
 *  place, so by reset time we cannot re-read the author's colour from the
 *  layer and must replay the captured value.
 *
 *  Restoring `fillColor` to the captured base may be a no-op for a layer
 *  the author never set (the base was `null`); writing `null` through
 *  `setStyle` triggers a re-render with the author's original state, which
 *  is exactly what reset is supposed to produce. The persisted override is
 *  removed either way so the next load does not re-apply a colour the
 *  layer no longer shows. */
const resetLayerFill = (ui: LayerUI, layerId: string): void => {
  if (!ui.m.layerRegistry.has(layerId)) return;
  delete ui.fillColorMap[layerId];
  unmarkOverride(ui, layerId, "fillColor");
  saveState(ui);
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
  const walk = (node: StyleCarrier): void => {
    if (typeof node.setStyle === "function") {
      const base = authorFillBase.get(node);
      if (base) node.setStyle({ fillColor: base.fillColor });
    } else if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
    }
  };
  walk(layer);
};

/** Build the fill form row: the shared colour swatch, nothing else.
 *  Matches the HeatmapControl border row and the label row's swatch —
 *  a FORM_ROW whose control cell is a single <input type=color>. No
 *  reset button on the row: the panel's Reset footer handles it, which
 *  keeps Reset as one writer of "back to authored default". */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const stored = ui.fillColorMap[layerId];
  const color = stored ?? FILL_COLOR_DEFAULT;
  const colorInput = formColorInput({
    value: color,
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;
  return dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_FILL_ROW}` },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_fill")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, colorInput),
  );
};

/** Wire the shared live-colour binder to this row's commit path. Called
 *  from `openStylePanel` in index.ts, alongside the label colour binding. */
const bindFillRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const colorEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
  ) as HTMLInputElement | null;
  if (!colorEl) return;
  bindLiveColor(colorEl, value => commitFillColor(ui, layerId, value));
};

export {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  layerCanFill,
  resetLayerFill,
};
