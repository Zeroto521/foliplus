// Border row — the ⚙︎ drawer's "Layer" section stroke swatch + width.
//
// A self-managed LayerControl dimension (like label color, not like opacity
// or zoom range): the values live in `ui.borderColorMap` /
// `ui.borderWeightMap`, are persisted under `layerState.borderColor` /
// `layerState.borderWeight`, and reach the map by walking `eachLayer` and
// calling `setStyle` on every leaf that owns one. The dimension is not part
// of the executor's visible/opacity/zoomRange family; the write goes straight
// to the layer because `setStyle` is a direct Leaflet API call, not a
// projection of a stored intent.
//
// Gate (honest degradation): only layers whose surface resolves to a pane
// carrier for BOTH opacity and zoom range get a border row — those are the
// vector shapes (Polygon, Polyline, Circle, CircleMarker, Rectangle, GeoJSON)
// whose leaves genuinely expose `setStyle`. Canvas layers (heatmap / measure)
// and third-party delegated drawers are excluded by construction, which is
// what keeps this row from ever appearing alongside the heatmap's delegated
// border row in the same panel. Base maps, MarkerCluster, GridLayer and
// ImageOverlay fall out of the capability check.
//
// UI chrome: shared `form.colorInput` + `numberInput` inside one FORM_ROW via
// `inlineControls` — the same recipe as the delegated border row and the
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
import { hasSetStyleLeaf, pinStyleOnHighlight } from "./pin.js";

/** A node in the layer tree that a border walk may reach. `setStyle` alone
 *  does not make a node a carrier — L.GeoJSON owns one too (it fans a style
 *  out to its features) — so every walk below checks `eachLayer` first and
 *  treats a setter as a leaf only. */
type StyleCarrier = L.Layer & {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
  options?: { color?: string; weight?: number };
};

/** A carrier whose `setStyle` is there for real. Narrowing through a guard
 *  rather than a `typeof` test keeps the call site a plain method call, which
 *  matters: Leaflet's `Path.setStyle` runs `setOptions(this, style)`, so the
 *  method captured into a local and called detached would see `this` as
 *  undefined and throw instead of writing. */
type StyleSetter = StyleCarrier & {
  setStyle: (style: Record<string, unknown>) => void;
};

const isStyleSetter = (node: StyleCarrier): node is StyleSetter =>
  typeof node.setStyle === "function";

/** Whether the layer's surface can honestly carry a border write. Requires
 *  the surface to resolve to a pane carrier for BOTH opacity and zoom range —
 *  that is exactly the vector-shape population. Anything else falls out:
 *    - `layerInfo.canvas` — callback-only canvas layers (heatmap / measure)
 *      have no `eachLayer` to walk, so a `setStyle` would silently no-op.
 *    - `layerInfo.styleSetters` — third-party delegated drawers own their
 *      style write; this row would fight for the same visual axis.
 *    - `capabilities.opacity === "native"` — GridLayer / ImageOverlay paint
 *      through native options, not through `setStyle`.
 *    - `capabilities.opacity === "none"` — MarkerCluster and the "no content
 *      panes" surface have no honest write target.
 *
 *  Requiring `zoomRange !== "none"` too is the same test from the other side:
 *  any surface whose `opacity` resolves to `"pane"` but whose `zoomRange` does
 *  not is a solid-color basemap, which owns a single background pane rather
 *  than vector shapes and has no stroke axis at all. The double check reads
 *  the capability honestly rather than special-casing the basemap id.
 *
 *  The third gate narrows the row to layers that actually own a `setStyle`
 *  leaf — the honest carrier for the write. A Marker or an empty LayerGroup
 *  passes the capability check but has no leaf to stroke: the row would
 *  persist a value with no visual effect, the same lie as Fill's Polygon-leaf
 *  check. Reads the carrier through `hasSetStyleLeaf` (§44.2: capability =
 *  the existence of a carrier object) so border and fill admit a layer on the
 *  same invariant. */
const layerCanBorder = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  if (li.canvas) return false;
  if (li.styleSetters) return false;
  const caps = ui.m.surfaceFor(li).capabilities;
  if (!(caps.opacity === "pane" && caps.zoomRange === "pane")) return false;
  return hasSetStyleLeaf(li.layer as StyleCarrier | null);
};

/** The layer's authored border style, captured on the layer's first border
 *  write and never re-read. Same recipe as the opacity base: `setStyle`
 *  mutates `options` in place, so by reset time we cannot re-read the
 *  author's color or width from the layer and must replay the captured
 *  value.
 *
 *  Keyed by `layer` identity, not by layer id, so a re-registration of the
 *  same id keeps its base across the swap. WeakMap so the entry disappears
 *  when the layer leaves the map, no explicit cleanup needed.
 *
 *  Per-leaf, because a GeoJSON layer's features can each declare their own
 *  style — one layer-wide base would erase the author's per-feature choice
 *  on reset.
 *
 *  Both fields are always populated: captureBase fills either one with the
 *  module default, so nothing downstream can tell "the author declared
 *  nothing" apart from "the author's own value". If that distinction ever
 *  matters — a Reset that behaves differently for the two — it is a decision
 *  about captureBase's capture semantics: re-add the null and read undefined
 *  out of options for real. Do not flatten it back with `??`. */
const authorBorderBase = new WeakMap<StyleCarrier, { color: string; weight: number }>();

/** Leaflet's own default `Path.color` — folium's style function always
 *  populates `options.color`, so this only fires for a bare Leaflet layer
 *  with no style declaration at all. */
const STYLE_BORDER_DEFAULT = "#3388ff";

const captureBase = (node: StyleCarrier): { color: string; weight: number } => {
  const existing = authorBorderBase.get(node);
  if (existing) return existing;
  const base = {
    color: node.options?.color ?? STYLE_BORDER_DEFAULT,
    weight: node.options?.weight ?? BORDER_WEIGHT.DEFAULT,
  };
  authorBorderBase.set(node, base);
  return base;
};

/** The first leaf that carries a style — the row's initial value is read
 *  from it, so a swatch or a number field never shows a value the layer is
 *  not actually painting.
 *
 *  Groups are always descended, never returned. L.GeoJSON defines `setStyle`
 *  itself — it fans the style out to its features — so a setter-only check
 *  stops at the group and reads its own options, which hold only the style
 *  function: the panel then shows Leaflet's defaults instead of the author's
 *  stroke, which is the stroke the layer is actually painting. */
const firstCarrier = (node: StyleCarrier): StyleSetter | null => {
  if (typeof node.eachLayer === "function") {
    let found: StyleSetter | null = null;
    node.eachLayer(child => {
      if (!found) found = firstCarrier(child as StyleCarrier);
    });
    return found;
  }
  return isStyleSetter(node) ? node : null;
};

/** The authored border of one layer, or the Leaflet defaults for a layer
 *  that has no declared style. Reads the captured base first — `setStyle`
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

/** Commit the current border color and width to the layer. Walks the layer
 *  tree and calls `setStyle({color?, weight?})` once per leaf that has a
 *  setter — the two sub-dimensions ride the same call so a color change
 *  and a width change can never disagree about the stroke. A node without a
 *  setter is skipped silently.
 *
 *  Reads both values from the UI maps; a sub-dimension not in the map is
 *  omitted from the `setStyle` call so the author's declared default stays
 *  in force.
 *
 *  Called from the two commit paths and from the replay hook, so the walk
 *  is the single writer of a border style — the commits only record intent. */
const applyBorderToLayer = (ui: LayerUI, layerId: string): void => {
  const color = ui.borderColorMap[layerId];
  const weight = ui.borderWeightMap[layerId];
  if (color === undefined && weight === undefined) return;
  const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
  if (!layer) return;
  const style: Record<string, unknown> = {};
  if (color !== undefined) style.color = color;
  if (weight !== undefined) style.weight = weight;
  const walk = (node: StyleCarrier): void => {
    // Groups are descended, never written: a group with a `setStyle` of its
    // own (L.GeoJSON, L.FeatureGroup) would be written in place of its
    // features, capturing the base on the group and leaving each feature
    // without one, so a Reset would restore the defaults.
    if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
      return;
    }
    if (!isStyleSetter(node)) return;
    captureBase(node);
    node.setStyle(style);
    // Pin the leaf's stroke against folium's highlight restore via the shared
    // pinStyleOnHighlight hook (§47.1-①). The border row previously kept its
    // own WeakSet + pinLeaf; that fired a second `mouseout` handler on the
    // same leaf as the fill row's pin, so a highlight-restore ran one, then
    // the other, and the last-bound one won — border overwrote fill on the
    // next mouseout, dropping the user's fill. One shared hook means the
    // leaf keeps exactly one pin that reads both dimensions live.
    pinStyleOnHighlight(node, () => {
      const c = ui.borderColorMap[layerId];
      const w = ui.borderWeightMap[layerId];
      if (c === undefined && w === undefined) return null;
      const stroke: Record<string, unknown> = {};
      if (c !== undefined) stroke.color = c;
      if (w !== undefined) stroke.weight = w;
      return stroke;
    });
  };
  walk(layer);
};

/** Write the color into the map, persist it, and mark the dimension as
 *  user-owned so it survives a reload. Only writes when the value actually
 *  moved — a color-picker drag revisits every step, and each pass is a
 *  sweep over every feature of the layer.
 *
 *  Called from `bindLiveColor`, so `rawColor` is a raw `input.value` and is
 *  normalised to 6-digit lowercase hex before landing in storage. */
const commitBorderColor = (ui: LayerUI, layerId: string, rawColor: string): void => {
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
 *  entry. "Authored" means the base captured on first write — `setStyle`
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
    // Descended, not written — same reason as the write walk: a group's
    // captured base would be the Leaflet defaults, not the author's stroke.
    if (typeof node.eachLayer === "function") {
      node.eachLayer(child => walk(child as StyleCarrier));
      return;
    }
    if (typeof node.setStyle !== "function") return;
    const base = authorBorderBase.get(node);
    if (!base) return;
    // Both dimensions are written unconditionally: the captured base always
    // holds a color and a width, so there is nothing to omit here.
    node.setStyle({ color: base.color, weight: base.weight });
  };
  walk(layer);
};

/** Replay the stored border intent onto the layer's own leaves. The executor
 *  never carries a border — `setStyle` is a direct Leaflet call, so nothing
 *  else writes it — which means a reload would otherwise restore the row's
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

/** Resolve an authored color to the `#rrggbb` form the color input's
 *  value is actually defined for.
 *
 *  The author may declare a stroke in any CSS form — a named color is what
 *  folium's quickstart uses for its faces. A non-hex declaration is resolved
 *  here through the browser rather than through a hand-kept name-to-hex
 *  table, so the field's value is stable in jsdom, in a headless engine and
 *  in a real one without repeating the same lookup three times.
 *
 *  Resolution stops at two honest failures. A value no engine accepts is
 *  rejected on assignment, so the probe stays empty and the declaration is
 *  passed through. CSS Color 4 functions are accepted but reported by
 *  `getComputedStyle` unnormalized, so the rgb parse finds no channel —
 *  `oklch(...)`, `lab(...)` and `color(...)` reach the field as declared and
 *  the input shows its own default. That is the limit of what this boundary
 *  can say without a canvas the test doubles do not provide.
 *
 *  The display boundary only: the authored value stays what the layer is set
 *  to, so the map and a Reset keep it as declared. A value this resolver
 *  will not accept is passed through untouched, so an unpaintable declaration
 *  is not silently invented into one that can be painted. */
const displayColor = (value: string): string => {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const probe = document.createElement("span");
  probe.style.color = value;
  if (!probe.style.color) return value;
  const match = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(probe).color);
  const channels = (match?.[1] ?? "")
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(part => parseInt(part, 10));
  if (channels.length < 3 || channels.some(Number.isNaN)) return value;
  return `#${channels
    .slice(0, 3)
    .map(part => part.toString(16).padStart(2, "0"))
    .join("")}`;
};

/** Build the border form row: color swatch + width number input. Both
 *  controls live inside one FORM_CONTROL via `inlineControls`, so the row
 *  reads the same as the delegated border row and the label row.
 *
 *  Each input's initial value is the stored choice, falling back to the
 *  author's own `options` — never a constant — so the row shows what the
 *  layer is actually painting on first open. The color is resolved to the
 *  swatch's own form by `displayColor` before it reaches the field. */
const buildBorderRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const author = authoredBorder(ui, layerId);
  const colorInput = formColorInput({
    value: displayColor(ui.borderColorMap[layerId] ?? author.color),
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
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_CONTROL },
      inlineControls(colorInput, weightInput),
    ),
  );
};

/** Wire the shared live-color and live-number binders to this row's commit
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
