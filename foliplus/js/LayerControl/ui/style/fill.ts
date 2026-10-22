// Fill color row — the ⚙️ drawer's "Layer" section fill swatch.
//
// A self-managed LayerControl dimension (like label, not like opacity /
// zoom range): the value lives in `ui.intentStore` fillColor, is persisted under
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
// `"none"` and the gate rejects them naturally. A solid-color basemap
// declares `"native"` — the pane's paint *is* the fill.
//
// UI chrome: shared `form.colorInput` + `bindLiveColor`, the same recipe as
// the HeatmapControl border row and the annotation label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label color has it).
import { CAP_TIER, DIM, GROUP, type LayerInfo } from "#core/layer/index.js";
import type { FillRampConfig, LayerOverride } from "#core/layer/intent.js";
import * as CONST from "#foliplus/LayerControl/const.js";
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
import { showSolidBasemap } from "../color.js";
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { applyRampToLayer, resolveFillMode } from "./fillRamp.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import {
  FACE,
  type StyleCarrier,
  cancelStyleDimApply,
  commitStyleDim,
  flushStyleDimApply,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";

/** The swatch's last resort when even the browser probe cannot resolve the
 *  authored color to a hex — black, matching an empty `<input type=color>`. */
const DEFAULT_FILL_COLOR = "#000000";

/** Whether the layer is a solid-color basemap: a base layer whose fill is the
 *  value on `layerInfo.color` rather than a Leaflet layer's geometry.
 *
 *  `layerInfo.color` is the discriminator, not `layerInfo.canvas`: the color basemap *does*
 *  carry a `canvas` (its face element, which the export renderer draws — see
 *  `LayerFactory.createColor`), so excluding on `canvas` would never match it
 *  and silently drops its fill row. A heatmap canvas has no `color`, so it
 *  still belongs to the canvas family and is excluded here.
 *
 *  Used only by write paths (applyFillToLayer, resetLayerFill, buildFillRow)
 *  to route the color basemap's fill to `showSolidBasemap` instead of walking
 *  leaves. The gate (`layerCanFill`) reads the capability, not this. */
const isColorBasemap = (layerInfo: LayerInfo | undefined): boolean => {
  if (!layerInfo || layerInfo.styleSetters) return false;
  return Boolean(layerInfo.color) && layerInfo.group === GROUP.BASE;
};

/** Whether the layer's surface can honestly carry a fill write.
 *  Pure capability check: `capabilities.fill === "native"`.
 *
 *  The fill capability is probe-derived at the surface (see
 *  `detectCapabilities` in core/layer/LayerSurface.ts) — a layer whose
 *  tree has no areal `setStyle` leaf (Polygon, Circle, CircleMarker)
 *  declares `"none"`, so the gate rejects it naturally. Line-only layers
 *  (Polyline), markers, canvas layers, MarkerCluster, GridLayer /
 *  ImageOverlay all declare `"none"` for fill. A solid-color basemap
 *  declares `"native"` — the pane's paint *is* the fill.
 *  No extra checks belong here: the invariant is that `gate` is exactly
 *  the capability check, no carrier probes, no `isColorBasemap`
 *  special-cases, no canvas exclusion. */
const layerCanFill = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.fill === CAP_TIER.NATIVE;
};

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
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_FILL_COLOR;
};

/** Every fill-dimension intent key the user can own. The reset list, the
 *  valueSource check and the replay guard must agree on this set, so they
 *  name one array instead of each spelling the four keys — adding a key and
 *  updating only one of the three is the bug a reload with a persisted ramp
 *  would otherwise hide. */
const FILL_INTENT_KEYS: readonly LayerOverride[] = [
  INTENT.FILL_COLOR,
  INTENT.FILL_OPACITY,
  INTENT.FILL_RAMP,
  INTENT.FILL_MODE,
];

/** A visible `fillOpacity` used to *display* the row's opacity input when
 *  neither a stored override nor an authored value exists. 0.2 matches
 *  Leaflet's own default, so a row for a layer that never declared a fill
 *  opacity shows what the layer is actually painting. Display only — no
 *  write path reads this to change a layer's opacity. */
const VISIBLE_FILL_OPACITY = 0.2;

/** Commit the current fill color and opacity to the layer. Walks the layer
 *  tree and calls `setStyle({fillColor?, fillOpacity?})` on every leaf that
 *  has a `setStyle`. A node without a setter is skipped silently.
 *
 *  Reads both values from the intent record (`fillColor` / `fillOpacity`);
 *  a dimension not in the map is omitted from the `setStyle` call so the
 *  author's declared default stays in force.
 *
 *  Kept separate from the persistence plumbing (`commitFillColor`,
 *  `commitFillOpacity`) so the walk is unit-testable without a storage timer. */
const applyFillToLayer = (ui: LayerUI, layerId: string): void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);

  // Arm selection goes through the shared resolver: an absent mode is solid,
  // and a ramp config with no explicit mode is the pre-fillMode record shape,
  // so the config's presence alone means "paint by value". The solid arm never
  // reads fillRamp — the two arms are mutually exclusive on apply, even though
  // both configs stay stored (a mode switch back must restore the other arm).
  const ramp = getIntent(ui, layerId, INTENT.FILL_RAMP);
  const mode = resolveFillMode(ui, layerId, ramp);

  if (mode === "ramp" && ramp !== undefined) {
    // A solid-color basemap has no leaves to classify, so a ramp degrades to
    // the authored pane paint instead of painting nothing.
    if (!isColorBasemap(layerInfo)) {
      applyRampToLayer(ui, layerId, ramp);
    }
    return;
  }

  const color = getIntent(ui, layerId, INTENT.FILL_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);

  // Solid-color basemap: the fill is the pane's paint, not a vector style.
  // Route to showSolidBasemap instead of walking leaves (the basemap has none).
  // Syncs ui.currentColor so a later checkbox toggle re-applies the same
  // color.
  if (isColorBasemap(layerInfo)) {
    if (color !== undefined) {
      ui.currentColor = color;
      showSolidBasemap(ui, color);
    }
    return;
  }

  // Snapshot-then-resolve: the registry's own `layer` reference is fast and
  // stable once populated, so it wins; the controller's `findLayer` re-resolves
  // against the live map for a folium layer whose registry reference is still
  // null. Same late-binding defense used by `applyBorderToLayer` and
  // `FILL_DIMENSION.reset`.
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as StyleCarrier | null;
  if (!layer) return;
  const values: Record<string, unknown> = {};
  if (color !== undefined) values.fillColor = color;
  if (opacity !== undefined) values.fillOpacity = opacity;
  const hasOverride = color !== undefined || opacity !== undefined;
  walkStyleLeaves(layer, node => {
    const written = styleBagOf(node) !== undefined;
    // A leaf that was never written and has nothing to own is left alone: no
    // restore, no listener. An uncommitted layer keeps folium's own hover
    // handling and gains no per-leaf cost.
    if (!hasOverride && !written) return;
    // Solid owns the whole fill face, so the leaf starts from the author's
    // paint. Without the restore a solid commit would be merged onto the
    // ramp's output: an opacity-only solid apply would keep the ramp's colour
    // under the user's opacity, and a no-override apply would hold the
    // previous arm's colour on the map until folium's next mouseout happened
    // to overwrite it. The pin below then replaces the ramp's getter, which
    // would otherwise still be holding this leaf.
    restoreStyleDim(node, FACE.FILL);
    if (hasOverride) {
      // Shared write contract: value keys + visibility bit (`fill: true`).
      commitStyleDim(node, values, FACE.FILL);
    }

    // Folium's highlight_on_hover restores the original style on mouseout;
    // pinStyleOnHighlight reapplies the user's fill after folium's handler
    // fires so the color survives the hover. `walkStyleLeaves` already
    // guarantees a setStyle, so no isStyleSetter guard is needed here.
    // The "fill" key makes each commit replace this dimension's getter
    // instead of stacking a fresh closure.
    pinStyleOnHighlight(node, DIM.FILL, () => {
      const c = getIntent(ui, layerId, INTENT.FILL_COLOR);
      const o = getIntent(ui, layerId, INTENT.FILL_OPACITY);
      if (c === undefined && o === undefined) return null;
      // fill:true rides the replay too — folium's resetStyle would otherwise
      // re-apply the author's fill:false on mouseout and hide the fill.
      return styleDimPayload({ fillColor: c, fillOpacity: o }, FACE.FILL);
    });
  });
};

/** Shared apply scheduler (styleBag, face=`fill`): one walk per frame.
 *  The wrapper exists only to bind this face's apply fn — flush / drop /
 *  has go straight to styleBag at the call site. */
const scheduleFillApply = (ui: LayerUI, layerId: string): void => {
  scheduleStyleDimApply(FACE.FILL, layerId, () => applyFillToLayer(ui, layerId));
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
  if (getIntent(ui, layerId, INTENT.FILL_COLOR) === color) return;
  getDimension(DIM.FILL)!.write!(ui, layerId, { color });
};

/** Commit the fill opacity (0-100 %) to the layer. Converts to 0-1 for
 *  storage and setStyle. Called from `bindLiveNumber` on the opacity input. */
const commitFillOpacity = (ui: LayerUI, layerId: string, pct: number): void => {
  const opacity = Math.max(0, Math.min(1, pct / 100));
  if (getIntent(ui, layerId, INTENT.FILL_OPACITY) === opacity) return;
  getDimension(DIM.FILL)!.write!(ui, layerId, { opacity });
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
  if (!ui.c.layerRegistry.has(layerId)) return;
  // Solid-color basemap: restore the authored default color. No style-bag
  // face to replay — the pane's fill IS the basemap color.
  if (isColorBasemap(ui.c.layerRegistry.get(layerId))) {
    cancelStyleDimApply(FACE.FILL, layerId);
    resetIntentKeys(ui, layerId, FILL_INTENT_KEYS);
    ui.currentColor = CONST.COLOR.DEFAULT;
    showSolidBasemap(ui, CONST.COLOR.DEFAULT);
    return;
  }
  // Vector / other fillable carriers: descriptor reset owns intent+persist
  // and the styleBag restore walk.
  getDimension(DIM.FILL)!.reset!(ui, layerId);
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
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const isBasemap = isColorBasemap(layerInfo!);

  // One styleBaseOf call feeds both the color swatch and the fill-opacity
  // input — the two values used to be read by separate walks, doubling
  // the findLayer + firstStyleLeaf traversal on every row paint.
  const base = isBasemap ? null : styleBaseOf(ui, layerId);

  const storedColor = getIntent(ui, layerId, INTENT.FILL_COLOR);
  const color = toHexColor(
    storedColor ?? (isBasemap ? CONST.COLOR.DEFAULT : base!.fillColor),
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

  const storedOpacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);
  const opacityPct = (storedOpacity ?? base!.fillOpacity ?? VISIBLE_FILL_OPACITY) * 100;
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
  if (colorEl) {
    bindLiveColor(colorEl, value => commitFillColor(ui, layerId, value));
    // change / blur close the drag: the trailing rAF frame may never fire
    // if the pointer lifts between frames — flush so the terminal value
    // lands (same contract as bindLiveNumber's change commit). Chain, never
    // overwrite: bindLiveColor only owns oninput today, but a future binder
    // that owns onchange must not be dropped (and the listener-guard
    // allow-list rejects bare addEventListener).
    const flush = () => flushStyleDimApply(FACE.FILL, layerId);
    const prevColorChange = colorEl.onchange;
    colorEl.onchange = ev => {
      prevColorChange?.call(colorEl, ev);
      flush();
    };
    colorEl.onblur = flush;
  }

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
    // bindLiveNumber already owns onchange (clamp + commit); chain the flush
    // instead of overwriting it. blur is free.
    const flush = () => flushStyleDimApply(FACE.FILL, layerId);
    const prevChange = opacityEl.onchange;
    opacityEl.onchange = ev => {
      prevChange?.call(opacityEl, ev);
      flush();
    };
    opacityEl.onblur = flush;
  }
};

/** Replay a layer's stored fill state (color + opacity) onto the map.
 *  Called from `applyUserState` on attach and late registration so a
 *  persisted value survives a reload. */
const replayFillState = (ui: LayerUI, id: string): void => {
  for (const key of FILL_INTENT_KEYS) {
    if (getIntent(ui, id, key) !== undefined) {
      applyFillToLayer(ui, id);
      return;
    }
  }
};

/** Register fill as a per-layer dimension. The descriptor wires the existing
 *  helpers plus the intent+persist slots: `write` / `reset` own store +
 *  styleBag orchestration (cohesive `LayerIntentStore.set` / `.clear`); the named
 *  `commitFillColor` / `commitFillOpacity` / `resetLayerFill` stay as thin
 *  delegates so panel call sites and tests keep their shape.
 *
 *  Registered ahead of `border` and `opacity` in `DIM_ORDER`
 *  (see `./registry.js`): fill comes first in the annotation panel's
 *  Layer section. */
const FILL_DIMENSION = registerDimension<{
  color: string;
  opacity: number | null;
  /** The active arm. "solid" is the derived default — it doubles as the
   *  shape of a pre-ramp record, so an absent mode reads back as solid. */
  mode: "solid" | "ramp";
  /** The value-based fill config. Kept while the active arm is solid, so a
   *  mode switch back restores it; undefined when never set. */
  ramp?: FillRampConfig;
}>({
  key: DIM.FILL,
  gate: layerCanFill,
  value: (ui, layerId) => {
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (!layerInfo) return undefined;
    // One styleBaseOf call feeds both keys; reading them separately
    // doubled the findLayer + firstStyleLeaf traversal per paint.
    const base = styleBaseOf(ui, layerId);
    return {
      color: getIntent(ui, layerId, INTENT.FILL_COLOR) ?? base.fillColor,
      opacity: getIntent(ui, layerId, INTENT.FILL_OPACITY) ?? base.fillOpacity,
      // "solid" is derived, not authored: no authored default exists for the
      // arm, so the fallback defers to whether a ramp config exists — the same
      // rule apply uses. Reading the stored mode with a solid fallback alone
      // would report solid while the map is painted by value.
      mode: resolveFillMode(ui, layerId, getIntent(ui, layerId, INTENT.FILL_RAMP)),
      ramp: getIntent(ui, layerId, INTENT.FILL_RAMP),
    };
  },
  row: buildFillRow,
  /** Intent+persist + schedule the fill face landing. `patch` is already
   *  normalized (hex / 0-1). Omitted keys leave that sub-dimension alone. */
  write: (ui, layerId, patch) => {
    const { color, opacity, mode, ramp } = patch;
    const writes: Array<readonly [IntentKey, unknown]> = [];
    if (color !== undefined) writes.push([INTENT.FILL_COLOR, color]);
    if (typeof opacity === "number") writes.push([INTENT.FILL_OPACITY, opacity]);
    if (mode !== undefined) writes.push([INTENT.FILL_MODE, mode]);
    if (ramp !== undefined) writes.push([INTENT.FILL_RAMP, ramp]);
    if (!writeIntentKeys(ui, layerId, writes)) return;
    scheduleFillApply(ui, layerId);
  },
  /** Cohesive reset: cancel trailing apply, clear both fill overrides,
   *  save, restore the author's fill face from the style bag. */
  reset: (ui, layerId) => {
    cancelStyleDimApply(FACE.FILL, layerId);
    resetIntentKeys(ui, layerId, FILL_INTENT_KEYS);
    const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
    walkStyleLeaves(layer, node => restoreStyleDim(node, FACE.FILL));
  },
  valueSource: (ui, layerId) => {
    if (!layerCanFill(ui, layerId)) return "none";
    for (const key of FILL_INTENT_KEYS) {
      if (ui.intentStore.isUserSet(layerId, key)) return "user";
    }
    return "author";
  },
});

export {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  FILL_DIMENSION,
  layerCanFill,
  replayFillState,
  resetLayerFill,
};
