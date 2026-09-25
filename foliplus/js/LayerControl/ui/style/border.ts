// Border row 鈥?the 鈿欙笌 drawer's "Layer" section stroke swatch + width.
//
// A self-managed LayerControl dimension (like label colour, not like opacity
// or zoom range): the values live in `ui.borderColorMap` /
// `ui.borderWeightMap`, are persisted under `layerState.borderColor` /
// `layerState.borderWeight`, and reach the map by walking `eachLayer` and
// calling `setStyle` on every leaf that owns one. The dimension is not part
// of the executor's visible/opacity/zoomRange family; the write goes straight
// to the layer because `setStyle` is a direct Leaflet API call, not a
// projection of a stored intent.
//
// Gate (honest degradation): only layers whose surface resolves to a pane
// carrier for BOTH opacity and zoom range get a border row 鈥?those are the
// vector shapes (Polygon, Polyline, Circle, CircleMarker, Rectangle, GeoJSON)
// whose leaves genuinely expose `setStyle`. Canvas layers (heatmap / measure)
// and third-party delegated drawers are excluded by construction, which is
// what keeps this row from ever appearing alongside the heatmap's delegated
// border row in the same panel. Base maps, MarkerCluster, GridLayer and
// ImageOverlay fall out of the capability check.
//
// UI chrome: shared `form.colorInput` + `numberInput` inside one FORM_ROW via
// `inlineControls` 鈥?the same recipe as the delegated border row and the
// annotation label row, so a border row reads identically whether the layer
// paints through `setStyle` or through a component's own canvas.
import { dom } from "#common/dom.js";
import {
  BORDER_WEIGHT,
  bindLiveColor,
  bindLiveNumber,
  colorInput as formColorInput,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#common/form.js";
import * as CONST from "../../const.js";
import type { LayerUI } from "../index.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";

/** A node with a runtime style-setter 鈥?the honest border carrier. Vector
 *  leaves (Path subclasses: Polygon, Polyline, Circle, CircleMarker,
 *  Rectangle) all have one; a LayerGroup does not (it delegates). */
type StyleCarrier = L.Layer & {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
  options?: { color?: string; weight?: number };
};

/** Whether the layer's surface can honestly carry a border write. Requires
 *  the surface to resolve to a pane carrier for BOTH opacity and zoom range 鈥? *  that is exactly the vector-shape population. Anything else falls out:
 *    - `layerInfo.canvas` 鈥?callback-only canvas layers (heatmap / measure)
 *      have no `eachLayer` to walk, so a `setStyle` would silently no-op.
 *    - `layerInfo.styleSetters` 鈥?third-party delegated drawers own their
 *      style write; this row would fight for the same visual axis.
 *    - `capabilities.opacity === "native"` 鈥?GridLayer / ImageOverlay paint
 *      through native options, not through `setStyle`.
 *    - `capabilities.opacity === "none"` 鈥?MarkerCluster and the "no content
 *      panes" surface have no honest write target.
 *
 *  Requiring `zoomRange !== "none"` too is the same test from the other side:
 *  any surface whose `opacity` resolves to `"pane"` but whose `zoomRange` does
 *  not is a solid-color basemap, which owns a single background pane rather
 *  than vector shapes and has no stroke axis at all. The double check reads
 *  the capability honestly rather than special-casing the basemap id. */
const layerCanBorder = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  if (li.canvas) return false;
  if (li.styleSetters) return false;
  const caps = ui.m.surfaceFor(li).capabilities;
  return caps.opacity === "pane" && caps.zoomRange === "pane";
};

/** The layer's authored border style, captured on the layer's first border
 *  write and never re-read. Same recipe as the opacity base: `setStyle`
 *  mutates `options` in place, so by reset time we cannot re-read the
 *  author's colour or width from the layer and must replay the captured
 *  value.
 *
 *  Keyed by `layer` identity, not by layer id, so a re-registration of the
 *  same id keeps its base across the swap. WeakMap so the entry disappears
 *  when the layer leaves the map, no explicit cleanup needed.
 *
 *  Per-leaf, because a GeoJSON layer's features can each declare their own
 *  style 鈥?one layer-wide base would erase the author's per-feature choice
 *  on reset. */
const authorBorderBase = new WeakMap<
  StyleCarrier,
  { color: string | null; weight: number | null }
>();

/** Leaflet's own default `Path.color` 鈥?folium's style function always
 *  populates `options.color`, so this only fires for a bare Leaflet layer
 *  with no style declaration at all. */
const STYLE_BORDER_DEFAULT = "#3388ff";

const captureBase = (
  node: StyleCarrier,
): { color: string | null; weight: number | null } => {
  const existing = authorBorderBase.get(node);
  if (existing) return existing;
  const base = {
    color: node.options?.color ?? STYLE_BORDER_DEFAULT,
    weight: node.options?.weight ?? BORDER_WEIGHT.DEFAULT,
  };
  authorBorderBase.set(node, base);
  return base;
};

/** The first leaf that carries a style 鈥?the row's initial value is read
 *  from it, so a swatch or a number field never shows a value the layer is
 *  not actually painting. */
const firstCarrier = (node: StyleCarrier): StyleCarrier | null => {
  if (typeof node.setStyle === "function") return node;
  if (typeof node.eachLayer === "function") {
    let found: StyleCarrier | null = null;
    node.eachLayer(child => {
      if (!found) found = firstCarrier(child as StyleCarrier);
    });
    return found;
  }
  return null;
};

/** The authored border of one layer, or the Leaflet defaults for a layer
 *  that has no declared style. Reads the captured base first 鈥?`setStyle`
 *  mutates `options` in place, so after a write the layer's own options no
 *  longer hold the author's stroke and the base is the only copy. Never
 *  reads the user's stored value, so a stored value cannot feed back into
 *  the base and make a Reset restore the user's own choice. */
const authoredBorder = (
  ui: LayerUI,
  layerId: string,
): { color: string; weight: number } => {
  // findLayer, not registry.get(id).layer: folium layers register unresolved,
  // so the registry's own reference stays null until the layer materializes.
  const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
  const carrier = layer ? firstCarrier(layer) : null;
  const base = carrier ? authorBorderBase.get(carrier) : undefined;
  return {
    color: base?.color ?? carrier?.options?.color ?? STYLE_BORDER_DEFAULT,
    weight: base?.weight ?? carrier?.options?.weight ?? BORDER_WEIGHT.DEFAULT,
  };
};

/** Commit the current border colour and width to the layer. Walks the layer
 *  tree and calls `setStyle({color?, weight?})` once per leaf that has a
 *  setter 鈥?the two sub-dimensions ride the same call so a colour change
 *  and a width change can never disagree about the stroke. A node without a
 *  setter is skipped silently.
 *
 *  Reads both values from the UI maps; a sub-dimension not in the map is
 *  omitted from the `setStyle` call so the author's declared default stays
 *  in force.
 *
 *  Called from the two commit paths and from the replay hook, so the walk
 *  is the single writer of a border style 鈥?the commits only record intent. */
const applyBorderToLayer = (ui: LayerUI, layerId: string): void => {
  const color = ui.borderColorMap[layerId];
  const weight = ui.borderWeightMap[layerId];
  if (color === undefined && weight === undefined) return;
  const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
  if (!layer) return;
  const walk = (node: StyleCarrier): void => {
    if (typeof node.setStyle === "function") {
      captureBase(node);
      const style: Record<string, unknown> = {};
      if (color !== undefined) style.color = color;
      if (weight !== undefined) style.weight = weight;
      node.setStyle(style);
    } else if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
    }
  };
  walk(layer);
};

/** Write the colour into the map, persist it, and mark the dimension as
 *  user-owned so it survives a reload. Only writes when the value actually
 *  moved 鈥?a colour-picker drag revisits every step, and each pass is a
 *  sweep over every feature of the layer.
 *
 *  Called from `bindLiveColor`, so `rawColor` is a raw `input.value` and is
 *  normalised to 6-digit lowercase hex before landing in storage. */
const commitBorderColor = (
  ui: LayerUI,
  layerId: string,
  rawColor: string,
): void => {
  const color = normalizeHexColor(rawColor);
  if (ui.borderColorMap[layerId] === color) return;
  ui.borderColorMap[layerId] = color;
  markOverride(ui, layerId, "borderColor");
  saveState(ui);
  applyBorderToLayer(ui, layerId);
};

/** Commit the border width to the layer. Called from `bindLiveNumber` on the
 *  width input, which already clamps into the shared bounds. */
const commitBorderWeight = (ui: LayerUI, layerId: string, weight: number): void => {
  if (ui.borderWeightMap[layerId] === weight) return;
  ui.borderWeightMap[layerId] = weight;
  markOverride(ui, layerId, "borderWeight");
  saveState(ui);
  applyBorderToLayer(ui, layerId);
};

/** Reset one layer's border to its authored value and drop its persisted
 *  entry. "Authored" means the base captured on first write 鈥?`setStyle`
 *  mutates `options` in place, so the captured value is the only source of
 *  truth for the author's stroke by reset time.
 *
 *  Both sub-dimensions are restored from the captured base, and the
 *  persisted overrides are removed either way so the next load does not
 *  re-apply a stroke the layer no longer shows. */
const resetLayerBorder = (ui: LayerUI, layerId: string): void => {
  if (!ui.m.layerRegistry.has(layerId)) return;
  delete ui.borderColorMap[layerId];
  delete ui.borderWeightMap[layerId];
  unmarkOverride(ui, layerId, "borderColor");
  unmarkOverride(ui, layerId, "borderWeight");
  saveState(ui);
  const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
  if (!layer) return;
  const walk = (node: StyleCarrier): void => {
    if (typeof node.setStyle === "function") {
      const base = authorBorderBase.get(node);
      if (!base) return;
      const style: Record<string, unknown> = {};
      if (base.color !== null) style.color = base.color;
      if (base.weight !== null) style.weight = base.weight;
      node.setStyle(style);
    } else if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
    }
  };
  walk(layer);
};

/** Replay the stored border intent onto the layer's own leaves. The executor
 *  never carries a border 鈥?`setStyle` is a direct Leaflet call, so nothing
 *  else writes it 鈥?which means a reload would otherwise restore the row's
 *  value in the drawer while the map keeps painting the author's stroke.
 *
 *  Called from `LayerUI.applyUserState`, so it runs on the attach sweep and
 *  on a late registration alike: a layer that registers after the sweep has
 *  taken its stored state replays itself, exactly as opacity does. `id`
 *  scopes the replay to one layer; omitted replays every stored intent.
 *
 *  Only stored values are replayed, so a layer the user never touched keeps
 *  the author's declared stroke. */
const replayBorderState = (ui: LayerUI, id?: string): void => {
  const ids =
    id !== undefined
      ? [id]
      : Object.keys({ ...ui.borderColorMap, ...ui.borderWeightMap });
  for (const layerId of ids) applyBorderToLayer(ui, layerId);
};

/** Build the border form row: colour swatch + width number input. Both
 *  controls live inside one FORM_CONTROL via `inlineControls`, so the row
 *  reads the same as the delegated border row and the label row.
 *
 *  Each input's initial value is the stored choice, falling back to the
 *  author's own `options` 鈥?never a constant 鈥?so the row shows what the
 *  layer is actually painting on first open. */
const buildBorderRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const author = authoredBorder(ui, layerId);
  const colorInput = formColorInput({
    value: ui.borderColorMap[layerId] ?? author.color,
    className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
    ariaLabel: ui.T("style_border_color"),
  }) as HTMLInputElement;
  const weightInput = numberInput({
    value: ui.borderWeightMap[layerId] ?? author.weight,
    min: BORDER_WEIGHT.MIN,
    max: BORDER_WEIGHT.MAX,
    step: BORDER_WEIGHT.STEP,
    className: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
    ariaLabel: ui.T("style_border_weight"),
  }) as HTMLInputElement;

  return dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_BORDER_ROW}` },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("border")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, inlineControls(colorInput, weightInput)),
  );
};

/** Wire the shared live-colour and live-number binders to this row's commit
 *  paths. Called from `openStylePanel`. */
const bindBorderRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const colorEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_BORDER_COLOR_INPUT}`,
  ) as HTMLInputElement | null;
  if (colorEl) bindLiveColor(colorEl, value => commitBorderColor(ui, layerId, value));

  const weightEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT}`,
  ) as HTMLInputElement | null;
  if (weightEl) {
    bindLiveNumber(weightEl, {
      min: BORDER_WEIGHT.MIN,
      max: BORDER_WEIGHT.MAX,
      fallback: BORDER_WEIGHT.DEFAULT,
      onCommit: value => commitBorderWeight(ui, layerId, value),
    });
  }
};

export {
  applyBorderToLayer,
  authoredBorder,
  bindBorderRow,
  buildBorderRow,
  commitBorderColor,
  commitBorderWeight,
  layerCanBorder,
  replayBorderState,
  resetLayerBorder,
};
