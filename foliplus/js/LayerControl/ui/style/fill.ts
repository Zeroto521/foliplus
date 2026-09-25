// Fill color row — the ⚙︎ drawer's "Layer" section fill swatch.
//
// A self-managed LayerControl dimension (like label, not like opacity /
// zoom range): the value lives in `ui.fillColorMap`, is persisted under
// `layerState.fillColor`, and reaches the map by walking `eachLayer` and
// calling `setStyle` on every leaf that owns one. The dimension is not part
// of the executor's visible/opacity/zoomRange family; the write goes
// straight to the layer because `setStyle` is a direct Leaflet API call,
// not a projection of a stored intent.
//
// Gate (honest degradation): only AREAL vector layers get a fill row —
// the surface must resolve to a pane carrier for BOTH opacity and zoom range
// (the vector-shape population), and the layer tree must actually contain a
// polygon leaf. PolyLine has a stroke but no fill concept, so it falls out:
// a fill row there would write a value with no visual effect. Canvas layers
// (heatmap / measure) and third-party delegated drawers are excluded by
// construction; base maps, MarkerCluster, GridLayer, and ImageOverlay fall
// out of the capability check.
//
// UI chrome: shared `form.colorInput` + `bindLiveColor`, the same recipe as
// the HeatmapControl border row and the annotation label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label color has it).
import { GEOM_TYPE, type LayerInfo } from "#core/layer/index.js";
import { dom } from "#common/dom.js";
import {
  bindLiveColor,
  bindLiveNumber,
  colorInput as formColorInput,
  formRow,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#common/form.js";
import * as CONST from "../../const.js";
import type { LayerUI } from "../index.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";
import { type StyleSetter, pinStyleOnHighlight } from "./pin.js";

/** Default paint the swatch shows when no fill has been committed yet.
 *  Matches Leaflet's own `fillColor` default, so the first write the user
 *  makes lands at the layer's authored default rather than jumping to a
 *  different color — a change to the swatch should never *be* a jump to a
 *  value the layer already carries. */
const FILL_COLOR_DEFAULT = "#000000";

/** A node with a runtime style-setter — the honest fill carrier. Vector
 *  leaves (Path subclasses: Polygon, Polyline, Circle, CircleMarker,
 *  Rectangle) all have one; a LayerGroup does not (it delegates). */
type StyleCarrier = L.Layer & {
  setStyle?: (style: Record<string, unknown>) => void;
  eachLayer?: (fn: (layer: L.Layer) => void) => void;
  on?: (type: string, fn: () => void) => void;
  options?: { fillColor?: string; fillOpacity?: number };
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
 *  special-casing the basemap id.
 *
 *  The third gate narrows the row to areal layers: only polygon leaves
 *  (Polygon / Rectangle / Circle / CircleMarker) carry a fill, so a PolyLine
 *  — which also passes the capability check — must not get a row that would
 *  write a value with no visual effect. A mixed GeoJSON keeps the row when
 *  at least one leaf is a polygon (the write reaches exactly those leaves). */
const hasFillGeometry = (ui: LayerUI, li: LayerInfo): boolean => {
  const type = ui.m.surfaceFor(li).geometryType();
  if (type === GEOM_TYPE.POLYGON) return true;
  if (type !== GEOM_TYPE.UNKNOWN) return false;
  const layer = li.layer as StyleCarrier | null;
  if (!layer) return false;
  let found = false;
  walkStyleLeaves(layer, leaf => {
    if (leaf instanceof L.Polygon) found = true;
  });
  return found;
};

const layerCanFill = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  if (li.canvas) return false;
  if (li.styleSetters) return false;
  const caps = ui.m.surfaceFor(li).capabilities;
  if (!(caps.opacity === "pane" && caps.zoomRange === "pane")) return false;
  return hasFillGeometry(ui, li);
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
const authorFillBase = new WeakMap<
  StyleCarrier,
  { fillColor: string | null; fillOpacity: number | null }
>();

/** Leaflet's own default `fillColor` for vector paths, and the swatch's last
 *  resort when no leaf exposes an authored color. folium's default style
 *  function always populates `options.fillColor` (it translates
 *  `__folium_color` through `feature.properties.style`), so this only fires
 *  for bare Leaflet layers with no style function at all. */
const LEAFLET_DEFAULT_FILL = "#3388ff";

/** Normalise a color for `<input type=color>`, which only accepts hex.
 *  3-digit hex passes through `normalizeHexColor`; named and functional
 *  colors (folium's `fillColor: "gray"`) are resolved by the browser —
 *  jsdom cannot parse them and falls back to `#000000`, which is the
 *  accepted degradation in unit tests; the real picker shows the resolved
 *  hex. */
const toHexColor = (value: string): string => {
  if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value)) return normalizeHexColor(value);
  const probe = document.createElement("input");
  probe.type = "color";
  probe.value = value;
  const hex = probe.value;
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : FILL_COLOR_DEFAULT;
};

/** The layer's authored fill color — the first style leaf's `options.fillColor`,
 *  or Leaflet's default when nothing is declared. Mirrors the border row's
 *  `authoredBorder`: the swatch shows what the layer is actually painting on
 *  first open, not a constant. */
const authoredFillColor = (ui: LayerUI, layerId: string): string => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return LEAFLET_DEFAULT_FILL;
  let authored: string | null = null;
  walkStyleLeaves(layer, leaf => {
    if (authored === null && leaf.options?.fillColor != null) {
      authored = leaf.options.fillColor;
    }
  });
  return authored ?? LEAFLET_DEFAULT_FILL;
};

/** A visible `fillOpacity` used when the author set the fill to 0 (hollow).
 *  Without it a color change is invisible — the `fill` attribute updates but
 *  `fill-opacity="0"` hides it. 0.2 matches Leaflet's own default. */
const VISIBLE_FILL_OPACITY = 0.2;

/** Visit every leaf that exposes a runtime style-setter. Groups (LayerGroup,
 *  folium GeoJson) expose `setStyle` too, but they are walked down instead:
 *  the mouseout events fire on the leaf paths (never on the group), and the
 *  authored base is per leaf — one layer-wide base would erase the author's
 *  per-feature choice. The callback receives a leaf whose `setStyle` is
 *  guaranteed present, so it can call it without a `typeof` dance. */
const walkStyleLeaves = (
  node: StyleCarrier,
  fn: (
    leaf: StyleCarrier & { setStyle: (style: Record<string, unknown>) => void },
  ) => void,
): void => {
  if (typeof node.eachLayer === "function") {
    node.eachLayer(child => walkStyleLeaves(child as StyleCarrier, fn));
    return;
  }
  if (typeof node.setStyle === "function") {
    fn(node as StyleCarrier & { setStyle: (style: Record<string, unknown>) => void });
  }
};

const captureBase = (
  node: StyleCarrier,
): {
  fillColor: string | null;
  fillOpacity: number | null;
} => {
  const existing = authorFillBase.get(node);
  if (existing) return existing;
  const base = {
    fillColor: node.options?.fillColor ?? LEAFLET_DEFAULT_FILL,
    fillOpacity: node.options?.fillOpacity ?? null,
  };
  authorFillBase.set(node, base);
  return base;
};

/** Commit the current fill color and opacity to the layer. Walks the layer
 *  tree and calls `setStyle({fillColor?, fillOpacity?})` on every leaf that
 *  has a `setStyle`. A node without a setter is skipped silently.
 *
 *  Reads both values from the UI maps (`fillColorMap` / `fillOpacityMap`);
 *  a dimension not in the map is omitted from the `setStyle` call so the
 *  author's declared default stays in force.
 *
 *  Kept separate from the persistence plumbing (`commitFillColor`,
 *  `commitFillOpacity`) so the walk is unit-testable without a storage timer. */
const applyFillToLayer = (ui: LayerUI, layerId: string): void => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
  const color = ui.fillColorMap[layerId];
  const opacity = ui.fillOpacityMap[layerId];
  if (color === undefined && opacity === undefined) return;
  walkStyleLeaves(layer, node => {
    captureBase(node);
    const style: Record<string, unknown> = {};
    if (color !== undefined) style.fillColor = color;
    if (opacity !== undefined) style.fillOpacity = opacity;
    node.setStyle(style);

    // Folium's highlight_on_hover restores the original style on mouseout;
    // pinStyleOnHighlight reapplies the user's fill after folium's handler
    // fires so the color survives the hover. `walkStyleLeaves` already
    // guarantees a setStyle, so no isStyleSetter guard is needed here.
    pinStyleOnHighlight(node, () => {
      const c = ui.fillColorMap[layerId];
      const o = ui.fillOpacityMap[layerId];
      if (c === undefined && o === undefined) return null;
      const s: Record<string, unknown> = {};
      if (c !== undefined) s.fillColor = c;
      if (o !== undefined) s.fillOpacity = o;
      return s;
    });
  });
};

/** Write the color into the map, persist it, and mark the dimension as
 *  user-owned so it survives a reload. Only writes when the value actually
 *  moved — a color-picker drag revisits every step, and each pass is a
 *  sweep over every feature of the layer.
 *
 *  When the layer is hollow (author fillOpacity === 0) and the user has not
 *  explicitly set fillOpacity, bumps fillOpacityMap to a visible value so
 *  the color change is visible. If the user HAS explicitly set fillOpacity
 *  (even to 0), their choice wins — no bump.
 *
 *  Called from `bindLiveColor`, so `color` is a raw `input.value` and is
 *  normalized to 6-digit lowercase hex before landing in storage. */
const commitFillColor = (ui: LayerUI, layerId: string, rawColor: string): void => {
  const color = normalizeHexColor(rawColor);
  if (ui.fillColorMap[layerId] === color) return;
  ui.fillColorMap[layerId] = color;
  markOverride(ui, layerId, "fillColor");

  if (ui.fillOpacityMap[layerId] === undefined) {
    const li = ui.m.layerRegistry.get(layerId);
    const layer = li?.layer as StyleCarrier | null;
    if (layer) {
      let hollow = false;
      walkStyleLeaves(layer, node => {
        if (node.options?.fillOpacity === 0) hollow = true;
      });
      if (hollow) {
        ui.fillOpacityMap[layerId] = VISIBLE_FILL_OPACITY;
        markOverride(ui, layerId, "fillOpacity");
      }
    }
  }

  saveState(ui);
  applyFillToLayer(ui, layerId);
};

/** Commit the fill opacity (0-100 %) to the layer. Converts to 0-1 for
 *  storage and setStyle. Called from `bindLiveNumber` on the opacity input. */
const commitFillOpacity = (ui: LayerUI, layerId: string, pct: number): void => {
  const opacity = Math.max(0, Math.min(1, pct / 100));
  if (ui.fillOpacityMap[layerId] === opacity) return;
  ui.fillOpacityMap[layerId] = opacity;
  markOverride(ui, layerId, "fillOpacity");
  saveState(ui);
  applyFillToLayer(ui, layerId);
};

/** Reset one layer's fill to its authored value and drop its persisted
 *  entry. "Authored" means the base captured on first write — the same
 *  base-capture recipe opacity uses: `setStyle` mutates `options` in
 *  place, so by reset time we cannot re-read the author's color from the
 *  layer and must replay the captured value.
 *
 *  Both `fillColor` and `fillOpacity` are restored from the captured base.
 *  `fillOpacity` was written by {@link applyFillToLayer} when it was 0
 *  (to make the color change visible); reset puts it back to the author's
 *  original — 0 for a hollow polygon, undefined for the default.
 *
 *  The persisted override is removed either way so the next load does not
 *  re-apply a color the layer no longer shows. */
const resetLayerFill = (ui: LayerUI, layerId: string): void => {
  if (!ui.m.layerRegistry.has(layerId)) return;
  delete ui.fillColorMap[layerId];
  delete ui.fillOpacityMap[layerId];
  unmarkOverride(ui, layerId, "fillColor");
  unmarkOverride(ui, layerId, "fillOpacity");
  saveState(ui);
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
  walkStyleLeaves(layer, node => {
    const base = authorFillBase.get(node);
    if (base) {
      const style: Record<string, unknown> = { fillColor: base.fillColor };
      if (base.fillOpacity !== null) {
        style.fillOpacity = base.fillOpacity;
      }
      node.setStyle(style);
    }
  });
};

/** Build the fill form row: color swatch + fill-opacity number input.
 *  Both controls live inside one FORM_CONTROL via `inlineControls`, so the
 *  row's width matches the border-weight row (color + number).
 *
 *  The swatch shows the stored choice, falling back to the layer's authored
 *  fill color — never a constant — so the row reflects what the layer is
 *  actually painting on first open, and named authored colors are resolved
 *  to the hex the picker can display. The opacity input's initial value is
 *  the author's `options.fillOpacity` (captured from the first leaf if
 *  available), or 0.2 (Leaflet's default) if the layer hasn't been
 *  registered yet. */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const storedColor = ui.fillColorMap[layerId];
  const color = toHexColor(storedColor ?? authoredFillColor(ui, layerId));
  const colorInput = formColorInput({
    value: color,
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;

  const storedOpacity = ui.fillOpacityMap[layerId];
  const opacityPct = (storedOpacity ?? VISIBLE_FILL_OPACITY) * 100;
  const opacityInput = numberInput({
    value: opacityPct,
    min: 0,
    max: 100,
    step: 5,
    className: CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER,
    ariaLabel: ui.T("style_fill_opacity"),
  }) as HTMLInputElement;

  return formRow(
    ui.T("style_fill"),
    inlineControls(colorInput, opacityInput),
    CONST.CLASSES.STYLE_FILL_ROW,
  );
};

/** Wire the shared live-color and live-number binders to this row's
 *  commit paths. Called from `openStylePanel` in index.ts. */
const bindFillRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const colorEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
  ) as HTMLInputElement | null;
  if (colorEl) bindLiveColor(colorEl, value => commitFillColor(ui, layerId, value));

  const opacityEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
  ) as HTMLInputElement | null;
  if (opacityEl) {
    bindLiveNumber(opacityEl, {
      min: 0,
      max: 100,
      fallback: VISIBLE_FILL_OPACITY * 100,
      onCommit: value => commitFillOpacity(ui, layerId, value),
    });
  }
};

/** Replay a layer's stored fill state (color + opacity) onto the map.
 *  Called from `applyUserState` on attach and late registration so a
 *  persisted value survives a reload. */
const replayFillState = (ui: LayerUI, id: string): void => {
  if (ui.fillColorMap[id] === undefined && ui.fillOpacityMap[id] === undefined) return;
  applyFillToLayer(ui, id);
};

export {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  layerCanFill,
  replayFillState,
  resetLayerFill,
};
