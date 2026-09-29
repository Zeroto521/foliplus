// Fill color row — the ⚙︎ drawer's "Layer" section fill swatch.
//
// A self-managed LayerControl dimension (like label, not like opacity /
// zoom range): the value lives in `ui.intents.fillColor`, is persisted under
// `layerState.fillColor`, and reaches the map by walking `eachLayer` and
// calling `setStyle` on every leaf that owns one. The dimension is not part
// of the executor's visible/opacity/zoomRange family; the write goes
// straight to the layer because `setStyle` is a direct Leaflet API call,
// not a projection of a stored intent.
//
// Gate (honest degradation): pure capability check — `capabilities.fill
// === "native"`. The fill capability is probe-derived at the surface (a
// tree walk for areal `setStyle` leaves), so a line-only layer, a marker,
// a canvas layer, MarkerCluster, GridLayer / ImageOverlay all declare
// `"none"` and the gate rejects them naturally. A solid-colour basemap
// declares `"native"` — the pane's paint *is* the fill.
//
// UI chrome: shared `form.colorInput` + `bindLiveColor`, the same recipe as
// the HeatmapControl border row and the annotation label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label color has it).
import { CAP_TIER, DIM, GROUP, type LayerInfo } from "#core/layer/index.js";
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
import { showSolidBasemap } from "../color.js";
import type { LayerUI } from "../index.js";
import { clearIntent, getIntent, setIntent } from "../intent.js";
import { markOverride, saveState, unmarkOverride } from "../state.js";
import { pinStyleOnHighlight } from "./pin.js";
import { registerDimension } from "./registry.js";

/** The swatch's last resort when even the browser probe cannot resolve the
 *  authored color to a hex — black, matching an empty `<input type=color>`. */
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

/** Whether the layer is a solid-color basemap: a base layer whose fill is the
 *  value on `li.color` rather than a Leaflet layer's geometry.
 *
 *  `li.color` is the discriminator, not `li.canvas`: the colour basemap *does*
 *  carry a `canvas` (its face element, which the export renderer draws — see
 *  `LayerFactory.createColor`), so excluding on `canvas` would never match it
 *  and silently drops its fill row. A heatmap canvas has no `color`, so it
 *  still belongs to the canvas family and is excluded here.
 *
 *  Used only by write paths (applyFillToLayer, resetLayerFill, buildFillRow)
 *  to route the colour basemap's fill to `showSolidBasemap` instead of walking
 *  leaves. The gate (`layerCanFill`) reads the capability, not this. */
const isColorBasemap = (li: LayerInfo | undefined): boolean => {
  if (!li || li.styleSetters) return false;
  return Boolean(li.color) && li.group === GROUP.BASE;
};

/** Whether the layer's surface can honestly carry a fill write.
 *  Pure capability check: `capabilities.fill === "native"`.
 *
 *  The fill capability is probe-derived at the surface (see
 *  `detectCapabilities` in core/layer/LayerSurface.ts) — a layer whose
 *  tree has no areal `setStyle` leaf (Polygon, Circle, CircleMarker)
 *  declares `"none"`, so the gate rejects it naturally. Line-only layers
 *  (Polyline), markers, canvas layers, MarkerCluster, GridLayer /
 *  ImageOverlay all declare `"none"` for fill. A solid-colour basemap
 *  declares `"native"` — the pane's paint *is* the fill.
 *  No extra checks belong here: the invariant is that `gate` is exactly
 *  the capability check, no carrier probes, no `isColorBasemap`
 *  special-cases, no canvas exclusion. */
const layerCanFill = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  return ui.m.surfaceFor(li).capabilities.fill === CAP_TIER.NATIVE;
};

/** The layer's authored base style, captured on the layer's first fill
 *  write and never re-read. Same recipe as `authorOpacityBase` in
 *  ui/apply.ts: the slider is a multiplier over the author's value, so the
 *  base is read once at first write and the value in front of us on the
 *  next write is the *last write*, not the author's.
 *
 *  Keyed by `layer` identity (like `authorOpacityBase`), so the same layer
 *  object re-registered under the same id keeps its base; WeakMap so the
 *  entry disappears when the layer leaves the map, no explicit cleanup.
 *
 *  Per-leaf, because a GeoJSON layer's features can each declare their own
 *  style — one layer-wide base would erase the author's per-feature choice
 *  on reset. */
const authorFillBase = new WeakMap<
  StyleCarrier,
  { fillColor: string; fillOpacity: number }
>();

/** Leaflet's own default `fillColor` for vector paths, and the swatch's last
 *  resort when no leaf exposes an authored color. folium's default style
 *  function always populates `options.fillColor` (it translates
 *  `__folium_color` through `feature.properties.style`), so this only fires
 *  for bare Leaflet layers with no style function at all. */
const LEAFLET_DEFAULT_FILL = "#3388ff";

/** Normalize a color for `<input type=color>`, which only accepts hex.
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

/** The layer's authored fill opacity — the first style leaf's
 *  `options.fillOpacity`, or null when no leaf declares one. Mirrors
 *  `authoredFillColor`: the row shows what the layer is actually painting. */
const authoredFillOpacity = (ui: LayerUI, layerId: string): number | null => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return null;
  let authored: number | null = null;
  walkStyleLeaves(layer, leaf => {
    if (authored === null && typeof leaf.options?.fillOpacity === "number") {
      authored = leaf.options.fillOpacity;
    }
  });
  return authored;
};

/** A visible `fillOpacity` used to *display* the row's opacity input when
 *  neither a stored override nor an authored value exists. 0.2 matches
 *  Leaflet's own default, so a row for a layer that never declared a fill
 *  opacity shows what the layer is actually painting. Display only — no
 *  write path reads this to change a layer's opacity. */
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
): { fillColor: string; fillOpacity: number } => {
  const existing = authorFillBase.get(node);
  if (existing) return existing;
  const base = {
    fillColor: node.options?.fillColor ?? LEAFLET_DEFAULT_FILL,
    // An absent authored fillOpacity means Leaflet's own 0.2 default, so the
    // base records that value — a Reset must restore it, not leave the user's
    // written opacity in place (setStyle merges, it does not delete).
    fillOpacity: node.options?.fillOpacity ?? 0.2,
  };
  authorFillBase.set(node, base);
  return base;
};

/** Commit the current fill color and opacity to the layer. Walks the layer
 *  tree and calls `setStyle({fillColor?, fillOpacity?})` on every leaf that
 *  has a `setStyle`. A node without a setter is skipped silently.
 *
 *  Reads both values from the UI maps (`intents.fillColor` / `intents.fillOpacity`);
 *  a dimension not in the map is omitted from the `setStyle` call so the
 *  author's declared default stays in force.
 *
 *  Kept separate from the persistence plumbing (`commitFillColor`,
 *  `commitFillOpacity`) so the walk is unit-testable without a storage timer. */
const applyFillToLayer = (ui: LayerUI, layerId: string): void => {
  const li = ui.m.layerRegistry.get(layerId);
  const color = getIntent(ui, layerId, "fillColor");
  const opacity = getIntent(ui, layerId, "fillOpacity");
  if (color === undefined && opacity === undefined) return;

  // Solid-color basemap: the fill is the pane's paint, not a vector style.
  // Route to showSolidBasemap instead of walking leaves (the basemap has none).
  // Syncs ui.currentColor so a later checkbox toggle re-applies the same
  // color.
  if (isColorBasemap(li)) {
    if (color !== undefined) {
      ui.currentColor = color;
      showSolidBasemap(ui, color);
    }
    return;
  }

  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
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
    // The "fill" key makes each commit replace this dimension's getter
    // instead of stacking a fresh closure.
    pinStyleOnHighlight(node, DIM.FILL, () => {
      const c = getIntent(ui, layerId, "fillColor");
      const o = getIntent(ui, layerId, "fillOpacity");
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
 *  Color-only: this never touches `intents.fillOpacity`. A hollow layer (author
 *  fillOpacity === 0) stays hollow — the `fill` attribute takes the new color
 *  and `fill-opacity="0"` keeps it hidden, which is the honest rendering of
 *  the author's value. The opacity input beside the swatch (0-100) is how
 *  the user makes the color visible.
 *
 *  Called from `bindLiveColor`, so `color` is a raw `input.value` and is
 *  normalized to 6-digit lowercase hex before landing in storage. */
const commitFillColor = (ui: LayerUI, layerId: string, rawColor: string): void => {
  const color = normalizeHexColor(rawColor);
  if (getIntent(ui, layerId, "fillColor") === color) return;
  setIntent(ui, layerId, "fillColor", color);
  markOverride(ui, layerId, "fillColor");
  saveState(ui);
  applyFillToLayer(ui, layerId);
};

/** Commit the fill opacity (0-100 %) to the layer. Converts to 0-1 for
 *  storage and setStyle. Called from `bindLiveNumber` on the opacity input. */
const commitFillOpacity = (ui: LayerUI, layerId: string, pct: number): void => {
  const opacity = Math.max(0, Math.min(1, pct / 100));
  if (getIntent(ui, layerId, "fillOpacity") === opacity) return;
  setIntent(ui, layerId, "fillOpacity", opacity);
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
 *  Both `fillColor` and `fillOpacity` are restored from the captured base —
 *  0 for a hollow polygon, Leaflet's 0.2 default when the author never
 *  declared an opacity.
 *
 *  The persisted override is removed either way so the next load does not
 *  re-apply a color the layer no longer shows. */
const resetLayerFill = (ui: LayerUI, layerId: string): void => {
  if (!ui.m.layerRegistry.has(layerId)) return;
  clearIntent(ui, layerId, "fillColor");
  clearIntent(ui, layerId, "fillOpacity");
  unmarkOverride(ui, layerId, "fillColor");
  unmarkOverride(ui, layerId, "fillOpacity");
  saveState(ui);
  const li = ui.m.layerRegistry.get(layerId);

  // Solid-color basemap: restore the authored default colour.
  if (isColorBasemap(li)) {
    ui.currentColor = CONST.COLOR.DEFAULT;
    showSolidBasemap(ui, CONST.COLOR.DEFAULT);
    return;
  }

  const layer = li?.layer as StyleCarrier | null;
  if (!layer) return;
  walkStyleLeaves(layer, node => {
    const base = authorFillBase.get(node);
    if (base) {
      node.setStyle({ fillColor: base.fillColor, fillOpacity: base.fillOpacity });
    }
  });
};

/** Build the fill form row: color swatch + fill-opacity number input.
 *  Both controls live inside one FORM_CONTROL via `inlineControls`, so the
 *  row's width matches the border-weight row (color + number).
 *
 *  Both inputs show the stored choice, falling back to the layer's authored
 *  value (the first style leaf's options) — never a constant — so the row
 *  reflects what the layer is actually painting on first open, and named
 *  authored colors are resolved to the hex the picker can display. */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const li = ui.m.layerRegistry.get(layerId);
  const isBasemap = isColorBasemap(li!);

  const storedColor = getIntent(ui, layerId, "fillColor");
  const color = toHexColor(
    storedColor ?? (isBasemap ? CONST.COLOR.DEFAULT : authoredFillColor(ui, layerId)),
  );
  const colorInput = formColorInput({
    value: color,
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;

  // Solid-color basemaps have no fill opacity (their transparency is the pane's
  // CSS opacity, a different axis). Render only the color swatch.
  if (isBasemap) {
    return formRow(
      ui.T("style_fill"),
      dom.el("div", { class: "foliplus-form-inline" }, colorInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    );
  }

  const storedOpacity = getIntent(ui, layerId, "fillOpacity");
  const authoredOpacity = authoredFillOpacity(ui, layerId);
  const opacityPct = (storedOpacity ?? authoredOpacity ?? VISIBLE_FILL_OPACITY) * 100;
  const opacityInput = numberInput({
    value: opacityPct,
    min: 0,
    max: 100,
    // Any integer 0–100 is a legal opacity; the number field is the precise
    // companion to the live commit, so the spinner must not restrict the
    // input to multiples of a coarser step (the opacity row uses step 1 too).
    step: 1,
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
  if (getIntent(ui, id, "fillColor") === undefined && getIntent(ui, id, "fillOpacity") === undefined) return;
  applyFillToLayer(ui, id);
};

/** Register fill as a per-layer dimension. The descriptor wires up the
 *  existing helpers (gate + row + a two-slot value for the color /
 *  opacity pair) — nothing moves. The write path is intentionally not
 *  on the descriptor: `commitFillColor` / `commitFillOpacity` are the
 *  authoritative implementations and the panel keeps them separate from
 *  the discovery shape.
 *
 *  Registered ahead of `border` and `opacity` in `DIM_ORDER`
 *  (see `./registry.js`): fill comes first in the annotation panel's
 *  Layer section. */
const FILL_DIMENSION = registerDimension<{
  color: string;
  opacity: number | null;
}>({
  key: DIM.FILL,
  gate: layerCanFill,
  value: (ui, layerId) => {
    const li = ui.m.layerRegistry.get(layerId);
    if (!li) return undefined;
    return {
      color: getIntent(ui, layerId, "fillColor") ?? authoredFillColor(ui, layerId),
      opacity: getIntent(ui, layerId, "fillOpacity") ?? authoredFillOpacity(ui, layerId),
    };
  },
  row: buildFillRow,
});

export {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  FILL_DIMENSION,
  isColorBasemap,
  layerCanFill,
  replayFillState,
  resetLayerFill,
};
