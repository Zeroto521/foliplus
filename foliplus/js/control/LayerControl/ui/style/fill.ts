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
// the HeatmapControl border row and the label label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label color has it).
import { showSolidBasemap } from "../color.js";
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { isColorBasemap, paintsPerFeatureFill } from "./fillAuthor.js";
import {
  VISIBLE_FILL_OPACITY,
  buildFillOpacityInput,
  commitFillOpacity,
} from "./fillOpacity.js";
import {
  applyValueFill,
  bindValueDetail,
  buildValueDetail,
  declaredFill,
  declaredValue,
  disposeFillRow,
  effectiveFillValue,
  hasDeclaredValue,
  hasValueField,
  resolvedValue,
  valueFields,
  valueForUi,
  writeFillMode,
} from "./fillValue.js";
import {
  buildMonochromeOriginalDetail,
  buildOriginalDetail,
} from "./originalDetail.js";
import {
  type PaintDimension,
  type PaintSubDimension,
  applyPaintToLayer,
  bindPaintRow,
  buildPaintRow,
} from "./paintDimension.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { replayFace } from "./replay.js";
import {
  FACE,
  STYLE_BAG_DEFAULTS,
  type StyleCarrier,
  authorFaceOf,
  cancelStyleDimApply,
  commitStyleDim,
  commitStyleDimMerged,
  flushStyleDimApply,
  needsDerivation,
  restoreStyleDim,
  scheduleStyleDimApply,
  solidColorOf,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
  walkFillLeaves,
} from "./styleBag.js";
import { styleCapability } from "./styleCapability.js";
import {
  DIM,
  type LayerOverride,
  STYLE_MODE,
  type StyleMode,
  type ValueConfig,
  readFeatureFillColors,
} from "#core/layer/index.js";
import { resolveDisplayMode } from "#foliplus/style/displayMode.js";
import { isHexColor } from "#platform/color.js";
import { dom } from "#platform/dom.js";
import {
  PANEL_CLASS,
  bindLiveColor,
  bindLiveNumber,
  colorInput as formColorInput,
  formRow,
  inlineControls,
  normalizeHexColor,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import { readDeclaredBorder } from "#control/LayerControl/declaredParse.js";

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
const layerCanFill = (ui: LayerUI, layerId: string): boolean =>
  styleCapability(ui, layerId).dims.fill;

/** Normalize a color for `<input type=color>`, which only accepts hex.
 *  3-digit hex passes through `normalizeHexColor`; named and functional
 *  colors (folium's `fillColor: "gray"`) are resolved by the browser —
 *  jsdom cannot parse them and falls back to `#000000`, which is the
 *  accepted degradation in unit tests; the real picker shows the resolved
 *  hex. */
const toHexColor = (value: string): string => {
  if (isHexColor(value)) return normalizeHexColor(value);
  const probe = document.createElement("input");
  probe.type = "color";
  probe.value = value;
  // The platform sanitizes every rejected value to `#000000` (and resolves a
  // name it knows), so the readback is always a valid simple color — no second
  // guard can ever fire here.
  return probe.value;
};

/** Every fill-dimension intent key the user can own. The reset list, the
 *  valueSource check and the replay guard must agree on this set, so they
 *  name one array instead of each spelling the four keys — adding a key and
 *  updating only one of the three is the bug a reload with a persisted value fill
 *  would otherwise hide. */
const FILL_INTENT_KEYS: readonly LayerOverride[] = [
  INTENT.FILL_COLOR,
  INTENT.FILL_OPACITY,
  INTENT.FILL_VALUE,
  INTENT.FILL_MODE,
];

/** Apply the value-fill branch: paint the column the row shows (the stored
 *  config's field resolved against the current data, the same rule
 *  valueForUi applies). A solid-color basemap has no leaves to classify, so a
 *  value fill degrades to the authored pane paint instead of painting nothing.
 *  The live reader is the same chain, so the highlight pin replays the declared
 *  value fill on mouseout instead of folium's flat author face. */
const applyValueFillToLayer = (ui: LayerUI, layerId: string): void => {
  const value = effectiveFillValue(ui, layerId);
  if (value === undefined) return;
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (isColorBasemap(layerInfo)) return;
  applyValueFill(
    ui,
    layerId,
    resolvedValue(ui, layerId, value)!,
    stored => resolvedValue(ui, layerId, stored)!,
    () => effectiveFillValue(ui, layerId),
  );
};

/** Apply the solid / original branch: one colour (or none, in ORIGINAL — the
 *  author's per-feature paint is the target) plus the opacity override that
 *  rides both modes. Walks the layer tree, committing or restoring each leaf's
 *  author face. */
const applySolidFillToLayer = (
  ui: LayerUI,
  layerId: string,
  original: boolean,
): void => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const solid = !original;
  // SOLID owns exactly one colour. When no FILL_COLOR intent exists the base
  // colour is the layer's authored base — NOT each leaf's captured author bag,
  // which for a per-feature layer holds a different colour per leaf (restoring
  // it is the original mode's job, not solid's). The base is the same reader
  // the solid row's swatch uses (buildSolidDetail), so the panel and the map
  // cannot disagree about what "solid" means. Only a per-feature layer needs
  // the derivation: a uniform layer's author face is already one colour, so no
  // intent means no walk (an uncommitted layer keeps folium's own hover
  // handling and gains no listener). A degenerate value record (mode=value, no
  // config) and a colour basemap own no derivable base either.
  const deriveSolidBase =
    solid && !isColorBasemap(layerInfo) && needsDerivation(ui, layerId, FACE.FILL);
  const solidColor =
    getIntent(ui, layerId, INTENT.FILL_COLOR) ??
    (deriveSolidBase
      ? solidColorOf(ui, layerId, FACE.FILL, { excludeBasemap: true })
      : undefined);
  const color = original ? undefined : solidColor;
  // An opacity override rides BOTH modes (#953): even in ORIGINAL the user's
  // transparency is a real face the map must paint (the colour stays the
  // author's). The original-guard would silently drop an
  // opacity-only override the moment the mode reads ORIGINAL.
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

  // Snapshot-then-resolve: the registry's own layer reference is fast and
  // stable once populated, so it wins; the controller's findLayer re-resolves
  // against the live map for a folium layer whose registry reference is still
  // null. Same late-binding defense used by applyBorderToLayer and
  // FILL_DIMENSION.reset.
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as StyleCarrier | null;
  if (!layer) return;
  const values: Record<string, unknown> = {};
  if (color !== undefined) values.fillColor = color;
  if (opacity !== undefined) values.fillOpacity = opacity;
  const hasOverride = color !== undefined || opacity !== undefined;
  walkFillLeaves(layer, node => {
    const written = styleBagOf(node) !== undefined;
    // A leaf that was never written and has nothing to own is left alone: no
    // restore, no listener. An uncommitted layer keeps folium's own hover
    // handling and gains no per-leaf cost.
    if (!hasOverride && !written) return;
    // One setStyle per leaf, never a restore followed by a commit - the
    // two-call form wrote the same face twice per leaf, which doubled the DOM
    // and SVG attribute work on top of the walk.
    if (hasOverride && values.fillColor !== undefined) {
      // A color commit is minimal: it replaces every key the previous mode
      // could have left stale, and the user's opacity never arrives here
      // unset - fillOpacity is set on this same payload whenever the user
      // has chosen one. Leaving the opacity unnamed keeps the author's value,
      // which is the only value on the leaf while no opacity is chosen.
      commitStyleDim(node, values, FACE.FILL);
    } else if (hasOverride) {
      // An opacity-only commit replaces nothing but the opacity, so the
      // previous mode's color would ride under it: pull the author's keys
      // back in the same payload. The pin below replaces any value getter
      // still holding this leaf.
      commitStyleDimMerged(node, values, FACE.FILL, true);
    } else {
      // No override left: restore the author's face rather than skipping the
      // walk, or the previous mode's color stays on the map until folium's
      // next mouseout happens to overwrite it.
      restoreStyleDim(node, FACE.FILL);
    }

    // Folium's highlight_on_hover restores the original style on mouseout;
    // pinStyleOnHighlight reapplies the user's fill after folium's handler
    // fires so the color survives the hover. walkFillLeaves already
    // guarantees a setStyle, so no isStyleSetter guard is needed here.
    // The "fill" key makes each commit replace this dimension's getter
    // instead of stacking a fresh closure.
    pinStyleOnHighlight(node, DIM.FILL, () => {
      // The author's own colors are the paint here: folium's mouseout restore
      // already put them back, so there is no user face to replay over it. The
      // mode is resolved, not read off the intent, because an explore layer
      // opens in it before any mode has been written.
      if (displayFillMode(ui, layerId) === STYLE_MODE.ORIGINAL) {
        // The author's own colours are the paint here: folium's mouseout
        // restore already put them back, so there is no colour face to replay
        // over it. An opacity override still rides the mode (#953) and must
        // survive the hover — replay that alone.
        const o = getIntent(ui, layerId, INTENT.FILL_OPACITY);
        return o === undefined ? null : styleDimPayload({ fillOpacity: o }, FACE.FILL);
      }
      // Same derivation as the apply: a solid mode with no FILL_COLOR intent
      // owns the authored base colour, so a mouseout must replay THAT, not
      // folium's per-feature author face (which would bring the multi-colour
      // author paint back over the single solid colour).
      // Only replay a solid colour when the user actually owns the paint: a
      // solid mode with NO intent at all (an uncommitted per-feature layer)
      // has folium's own author restore on mouseout — replaying the base
      // would stamp the first leaf's colour over every leaf.
      const ownIntent =
        getIntent(ui, layerId, INTENT.FILL_COLOR) !== undefined ||
        getIntent(ui, layerId, INTENT.FILL_OPACITY) !== undefined ||
        getIntent(ui, layerId, INTENT.FILL_VALUE) !== undefined ||
        getIntent(ui, layerId, INTENT.FILL_MODE) !== undefined;
      const c = ownIntent ? solidColor : undefined;
      const o = getIntent(ui, layerId, INTENT.FILL_OPACITY);
      if (c === undefined && o === undefined) return null;
      // fill:true rides the replay too — folium's resetStyle would otherwise
      // re-apply the author's fill:false on mouseout and hide the fill.
      return styleDimPayload({ fillColor: c, fillOpacity: o }, FACE.FILL);
    });
  });
};

/** Commit the current fill color and opacity to the layer. Walks the layer
 *  tree and calls setStyle({fillColor?, fillOpacity?}) on every leaf that
 *  has a setStyle. A node without a setter is skipped silently.
 *
 *  The engine resolves the mode (the panel's resolver) and dispatches to the
 *  adapter's apply hooks — the same precedence the row uses, so the map and
 *  the panel cannot disagree about which mode is in force.
 *
 *  Kept separate from the persistence plumbing (commitFillColor,
 *  commitFillOpacity) so the walk is unit-testable without a storage timer. */
const applyFillToLayer = (ui: LayerUI, layerId: string): void => {
  applyPaintToLayer(FILL_ADAPTER, ui, layerId);
};
/** Shared apply scheduler (styleBag, face=`fill`): one walk per frame.
 *  The wrapper exists only to bind this face's apply fn — flush / drop /
 *  has go straight to styleBag at the call site. */
const scheduleFillApply = (ui: LayerUI, layerId: string): void => {
  scheduleStyleDimApply(FACE.FILL, layerId, () => applyFillToLayer(ui, layerId), {
    owner: ui,
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
  if (getIntent(ui, layerId, INTENT.FILL_COLOR) === color) return;
  getDimension(DIM.FILL)!.write!(ui, layerId, { color });
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
    cancelStyleDimApply(FACE.FILL, layerId, ui);
    resetIntentKeys(ui, layerId, FILL_INTENT_KEYS);
    ui.currentColor = CONST.COLOR.DEFAULT;
    showSolidBasemap(ui, CONST.COLOR.DEFAULT);
    return;
  }
  // Vector / other fillable carriers: descriptor reset owns intent+persist
  // and the styleBag restore walk.
  getDimension(DIM.FILL)!.reset!(ui, layerId);
};

/** What the fill row's mode select shows: the three modes of {@link StyleMode}.
 *
 *  "original" is the author's own per-feature paint. It is a real, stored
 *  choice on an explore layer (leave it and come back), and it is also the
 *  state a layer opens in before any fill intent exists — so the fallback
 *  below writes no intent of its own. */

/** The author record Python computed for this layer, when it has one. */
/** The mode the fill row shows and the map paints.
 *
 *  Only a layer the author paints per feature can be in "original": the
 *  record is the gate, so a stored "original" on any other layer (or on a
 *  layer whose record has since disappeared) reads as the normal modes instead
 *  of a state the layer cannot paint. Before any fill intent exists an explore
 *  layer opens on its author's colors without writing one — a stored value fill
 *  config is the pre-fillMode shape of "the user already classified". */
const displayFillMode = (ui: LayerUI, layerId: string): StyleMode => {
  const value = getIntent(ui, layerId, INTENT.FILL_VALUE);
  return resolveDisplayMode({
    stored: getIntent(ui, layerId, INTENT.FILL_MODE),
    declaredValue: declaredValue(ui, layerId) !== undefined,
    colorIntent: getIntent(ui, layerId, INTENT.FILL_COLOR) !== undefined,
    valueIntent: value !== undefined,
    carriesValue: true, // fill always carries value
    supportsInherit: false, // fill has no INHERIT
  });
};

/** The solid mode's detail: one row holding the color swatch and the
 *  fill-opacity number side by side (the border-row recipe). color and
 *  opacity are one idea — a fill without either half is rarely what the user
 *  means — so the mode stays on a single line instead of two stacked rows. */
const buildSolidDetail = (ui: LayerUI, layerId: string): HTMLElement[] => {
  const base = styleBaseOf(ui, layerId);
  const storedColor = getIntent(ui, layerId, INTENT.FILL_COLOR);
  const colorInput = formColorInput({
    value: toHexColor(storedColor ?? base.fillColor),
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;

  const opacityInput = buildFillOpacityInput(ui, layerId, base);

  return [
    formRow(
      ui.T("style_fill"),
      inlineControls(colorInput, opacityInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  ];
};
/** The fill detail builder for one mode. The shared engine owns the
 *  dispose/replace/append shape; this closure is the channel's one difference
 *  (which mode builds which rows). */
const fillDetailBuilder = (
  mode: StyleMode,
): ((ui: LayerUI, layerId: string) => HTMLElement[]) => {
  // The original-colors mode shows what the author declared and nothing
  // editable: the column (when a scale paired), the colors as one order, and
  // how many there are. No classification controls — those belong to the
  // user's own value fill.
  if (mode === STYLE_MODE.ORIGINAL) {
    return (ui, layerId) => {
      // A single-colour author has one paint to show: the compact [swatch |
      // opacity] read-only row (design §2.1). A per-feature author has no
      // single colour to put in a swatch — the shared original-colors detail
      // (column/colors/method/count) is the honest readout.
      if (paintsPerFeatureFill(ui, layerId)) {
        return buildOriginalDetail(ui, layerId);
      }
      return buildMonochromeOriginalDetail(ui, layerId);
    };
  }
  if (mode === STYLE_MODE.VALUE) {
    return (ui, layerId) => {
      if (!hasValueField(ui, layerId)) return buildSolidDetail(ui, layerId);
      const fields = valueFields(ui, layerId);
      return buildValueDetail(ui, layerId, fields, valueForUi(ui, layerId, fields));
    };
  }
  return (ui, layerId) => buildSolidDetail(ui, layerId);
};

/** The color-basemap row: the pane's paint is the fill, so the single
 *  swatch row (no modes, no per-feature values to classify). */
const buildFillBasemapRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const colorInput = formColorInput({
    value: toHexColor(getIntent(ui, layerId, INTENT.FILL_COLOR) ?? CONST.COLOR.DEFAULT),
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;
  const row = formRow(
    ui.T("style_fill"),
    dom.el("div", { class: PANEL_CLASS.FORM_INLINE }, colorInput),
    CONST.CLASSES.STYLE_FILL_ROW,
  );
  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_FILL_BLOCK, "data-style-dim": "fill" },
    row,
  );
};

/** The fill row chrome: the class vocabulary (static) + the translated mode
 *  label (per-UI). The engine reads the chrome from the adapter. */
const fillChrome = (ui: LayerUI) => ({
  blockClass: CONST.CLASSES.STYLE_FILL_BLOCK,
  selectClass: CONST.CLASSES.STYLE_FILL_MODE_SELECT,
  rowClass: CONST.CLASSES.STYLE_FILL_ROW,
  detailClass: CONST.CLASSES.STYLE_FILL_DETAIL,
  label: ui.T("style_fill_mode"),
});

/** The fill mode-row decoration: the per-feature explanation rides the
 *  control, not the drawer — the select and its original-colors option both
 *  carry the sentence as a tooltip/description, so hovering or a screen
 *  reader still gets it while the panel stays compact. */
const fillModeRowHint = (
  ui: LayerUI,
  layerId: string,
  select: HTMLSelectElement,
): void => {
  if (!paintsPerFeatureFill(ui, layerId)) return;
  const note = ui.T("style_fill_per_feature_note");
  select.title = note;
  select.setAttribute("aria-description", note);
  const original = select.querySelector(
    'option[value="original"]',
  ) as HTMLOptionElement | null;
  if (original) original.title = note;
};

/** Build the fill form block. A layer with numeric fields gets the mode row
 *  (solid / color by value) plus the active mode's detail; a layer without one
 *  gets the solid controls only — there is nothing to classify, so offering a
 *  disabled "Color by value" option would just be noise. A color basemap keeps
 *  the pre-existing single swatch row: its fill is the pane paint, which has no
 *  per-feature values to classify. */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement =>
  buildPaintRow(FILL_ADAPTER, ui, layerId);
/** Bind the solid mode's two live controls. */
const bindSolidDetail = (ui: LayerUI, layerId: string, detail: HTMLElement): void => {
  const colorEl = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
  ) as HTMLInputElement | null;
  if (colorEl) {
    bindLiveColor(colorEl, value => commitFillColor(ui, layerId, value));
    // change / blur close the drag: the trailing rAF frame may never fire if
    // the pointer lifts between frames — flush so the terminal value lands
    // (same contract as bindLiveNumber's change commit). Chain, never
    // overwrite: bindLiveColor only owns oninput today.
    const flush = () => flushStyleDimApply(FACE.FILL, layerId, ui);
    const prevColorChange = colorEl.onchange;
    // listener-exempt: style-panel color input change handler (flush chain) on a panel-owned element
    colorEl.onchange = ev => {
      prevColorChange?.call(colorEl, ev);
      flush();
    };
    // listener-exempt: style-panel color input blur handler (flush at drag end) on a panel-owned element
    colorEl.onblur = flush;
  }

  const opacityEl = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER}`,
  ) as HTMLInputElement | null;
  if (opacityEl) {
    bindLiveNumber(opacityEl, {
      min: 0,
      max: 100,
      fallback: VISIBLE_FILL_OPACITY * 100,
      // One decimal place in percent space: 0.555 reads and writes 55.5,
      // never 55.49999... — display and commit agree through the same step.
      normalize: value => Math.round(value * 10) / 10,
      onCommit: value => commitFillOpacity(ui, layerId, value),
    });
    // bindLiveNumber already owns onchange (clamp + commit); chain the flush
    // instead of overwriting it. blur is free.
    const flush = () => flushStyleDimApply(FACE.FILL, layerId, ui);
    const prevChange = opacityEl.onchange;
    // listener-exempt: style-panel opacity input change handler (flush chain) on a panel-owned element
    opacityEl.onchange = ev => {
      prevChange?.call(opacityEl, ev);
      flush();
    };
    // listener-exempt: style-panel opacity input blur handler (flush at drag end) on a panel-owned element
    opacityEl.onblur = flush;
  }
};
/** The fill sub-dimensions that ride every mode. The fill channel's
 *  opacity input is built inside each mode's detail row (solid, value,
 *  original) and bound by that mode's binder, so it is not a shared
 *  sub-element the engine sweeps separately — the sub list stays empty
 *  until the full adapter step mounts the opacity row through one builder. */
const fillSubs: PaintSubDimension[] = [];

/** The fill detail binder for one mode. The shared engine owns the
 *  sub-dimension sweep; this closure is the channel's one difference (which
 *  mode binds which controls). The original-colors detail is a read-only
 *  readout, so it binds nothing. */
const fillDetailBinder = (
  mode: StyleMode,
): ((ui: LayerUI, layerId: string, detail: HTMLElement) => void) => {
  if (mode === STYLE_MODE.ORIGINAL) {
    // The original-colors detail is a read-only readout: nothing to bind.
    return () => undefined;
  }
  if (mode === STYLE_MODE.VALUE) {
    return (ui, layerId, detail) => {
      if (hasValueField(ui, layerId)) bindValueDetail(ui, layerId, detail);
      else bindSolidDetail(ui, layerId, detail);
    };
  }
  return (ui, layerId, detail) => bindSolidDetail(ui, layerId, detail);
};

/** Wire the fill block: the mode select switches modes in place (rebuilding the
 *  detail slot), and the active mode's controls commit through the dimension's
 *  write path. A color basemap row or a layer with one mode (no numeric field)
 *  has no mode select and only owns the solid controls. */
/** Wire the fill block: the mode select switches modes in place (rebuilding the
 *  detail slot), and the active mode's controls commit through the dimension's
 *  write path. A color basemap row or a layer with one mode (no numeric field)
 *  has no mode select and only owns the solid controls. */
const bindFillRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const block = (row.closest("[data-style-dim='fill']") ??
    row.closest(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`)) as HTMLElement | null;
  if (!block) {
    // Color basemap: the single swatch row, no modes.
    bindSolidDetail(ui, layerId, row);
    return;
  }
  const select = block.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
  ) as HTMLSelectElement | null;
  if (!select) {
    // One honest mode: no mode row to switch; bind the solid controls only.
    bindSolidDetail(ui, layerId, block);
    return;
  }
  bindPaintRow(FILL_ADAPTER, ui, layerId, row);
};
/** The fill channel's paint-dimension adapter: every channel difference the
 *  engine needs, in one object. The row/apply entry points
 *  (buildFillRow / bindFillRow / applyFillToLayer) are the thin named
 *  delegates the registry and the panel call; the adapter carries the
 *  channel's own vocabulary, gates, and hooks. */
const FILL_ADAPTER: PaintDimension = {
  key: DIM.FILL,
  chrome: fillChrome,
  intentKeys: FILL_INTENT_KEYS,
  face: FACE.FILL,
  gate: layerCanFill,
  authorFace: (ui, layerId, key) => authorFaceOf(ui, layerId, FACE.FILL, key),
  needsDerivation: (ui, layerId) => needsDerivation(ui, layerId, FACE.FILL),
  displaySpec: (ui, layerId) => ({
    stored: getIntent(ui, layerId, INTENT.FILL_MODE),
    declaredValue: declaredValue(ui, layerId) !== undefined,
    colorIntent: getIntent(ui, layerId, INTENT.FILL_COLOR) !== undefined,
    valueIntent: getIntent(ui, layerId, INTENT.FILL_VALUE) !== undefined,
    carriesValue: true,
    supportsInherit: false,
  }),
  modes: (ui, layerId) => {
    const modes: StyleMode[] = [STYLE_MODE.ORIGINAL, STYLE_MODE.SOLID];
    if (hasValueField(ui, layerId)) modes.push(STYLE_MODE.VALUE);
    return modes;
  },
  subs: fillSubs,
  detailBuilder: fillDetailBuilder,
  detailBinder: fillDetailBinder,
  applyHooks: {
    value: applyValueFillToLayer,
    original: (ui, layerId) => applySolidFillToLayer(ui, layerId, true),
    solid: (ui, layerId) => applySolidFillToLayer(ui, layerId, false),
  },
  hasValue: (ui, layerId) => effectiveFillValue(ui, layerId) !== undefined,
  derivedKey: () => "fillColor" as const,
  writeMode: writeFillMode,
  dispose: disposeFillRow,
  isBasemap: (ui, layerId) => isColorBasemap(ui.c.layerRegistry.get(layerId)),
  buildBasemapRow: buildFillBasemapRow,
  modeRowHint: fillModeRowHint,
};

/** One attach-sweep paint per layer: `applyUserState()` also runs on folds
 *  and renames, and a declared value fill reclassifies every leaf — an idempotent
 *  but O(N) walk the sweep should not repeat. */
const declaredReplayed = new WeakMap<LayerUI, Set<string>>();

/** Attach-sweep replay for author-declared fills only.
 *
 *  The provenance loop in `replayFillState` reaches only layers the user
 *  touched; a layer whose fill is declared but never edited is absent from
 *  it, and only a declaration needs the extra pass. Layers with a stored
 *  intent are skipped so the sweep does not apply the same fill twice. */
const replayDeclaredFill = (ui: LayerUI, id: string): void => {
  for (const key of FILL_INTENT_KEYS) {
    if (getIntent(ui, id, key) !== undefined) return;
  }
  if (declaredFill(ui, id) === undefined) return;
  let painted = declaredReplayed.get(ui);
  if (painted?.has(id)) return;
  applyFillToLayer(ui, id);
  if (!painted) {
    painted = new Set();
    declaredReplayed.set(ui, painted);
  }
  painted.add(id);
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
  // No user intent: an author-declared value fill still has to reach the map on
  // attach — a declaration is a read-time default, not a stored override, so
  // nothing else replays it and the map would open on the per-feature paint.
  if (declaredFill(ui, id) !== undefined) applyFillToLayer(ui, id);
};

/** Register fill as a per-layer dimension. The descriptor wires the existing
 *  helpers plus the intent+persist slots: `write` / `reset` own store +
 *  styleBag orchestration (cohesive `LayerIntentStore.set` / `.clear`); the named
 *  `commitFillColor` / `commitFillOpacity` / `resetLayerFill` stay as thin
 *  delegates so panel call sites and tests keep their shape.
 *
 *  Registered ahead of `border` and `opacity` in `DIM_ORDER`
 *  (see `./registry.js`): fill comes first in the label panel's
 *  Layer section. */
const FILL_DIMENSION = registerDimension<{
  color: string;
  opacity: number | null;
  /** The active mode. "solid" is the derived default — it doubles as the
   *  shape of a pre-value record, so an absent mode reads back as solid. */
  mode: StyleMode;
  /** The value-based fill config. Kept while the active mode is solid, so a
   *  mode switch back restores it; undefined when never set. */
  value?: ValueConfig;
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
      // The same resolver the row and apply use: "solid" is derived, not
      // authored, so the readout defers to whether a value config exists (and,
      // on an explore layer, to the author's own colors) rather than claiming
      // a solid paint the map is not showing.
      mode: displayFillMode(ui, layerId),
      value: resolvedValue(ui, layerId, effectiveFillValue(ui, layerId)),
    };
  },
  row: buildFillRow,
  /** Bind the fill block's live controls. The panel hands the exact block
   *  `row()` built (already carrying data-style-dim=fill), so the block lookup
   *  in bindFillRow resolves to itself — no class-based re-lookup. */
  bind: bindFillRow,
  /** Intent+persist + schedule the fill face landing. `patch` is already
   *  normalized (hex / 0-1). Omitted keys leave that sub-dimension alone. */
  write: (ui, layerId, patch) => {
    const { color, opacity, mode, value } = patch;
    const writes: Array<readonly [IntentKey, unknown]> = [];
    if (color !== undefined) writes.push([INTENT.FILL_COLOR, color]);
    if (typeof opacity === "number") writes.push([INTENT.FILL_OPACITY, opacity]);
    if (mode !== undefined) writes.push([INTENT.FILL_MODE, mode]);
    if (value !== undefined) writes.push([INTENT.FILL_VALUE, value]);
    if (!writeIntentKeys(ui, layerId, writes)) return;
    scheduleFillApply(ui, layerId);
    // A follow-fill border is a per-leaf DERIVED paint: when the user
    // edits the fill (colour, mode, value), the border must re-derive from
    // each leaf's new paint. The fill write is the single commit path, so
    // the border replay rides here — no extra listener, no cross-face
    // event. Replay when the follow-fill mode is in force: stored (the
    // user chose it) or declared (foliplus.border follow_fill, no stored
    // mode). A stored solid/value border steps aside — it does not follow.
    const borderMode = getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE);
    const layerObj = ui.c.layerRegistry.get(layerId)?.layer ?? ui.c.findLayer(layerId);
    const borderFollowFill =
      borderMode === STYLE_MODE.FOLLOW_FILL ||
      (borderMode === undefined &&
        readDeclaredBorder(layerObj, layerId).declared === STYLE_MODE.FOLLOW_FILL);
    if (borderFollowFill) {
      replayFace(ui, layerId, FACE.STROKE);
    }
  },
  /** Cohesive reset: cancel trailing apply, clear both fill overrides,
   *  save, restore the author's fill face from the style bag. */
  reset: (ui, layerId) => {
    cancelStyleDimApply(FACE.FILL, layerId, ui);
    resetIntentKeys(ui, layerId, FILL_INTENT_KEYS);
    // The declaration is Reset's target too: clearing the user's intent must
    // reveal the author's declared value fill, not the per-feature paint beneath
    // it. Applying here reads the declaration from the layer (no intent left).
    if (declaredFill(ui, layerId) !== undefined) {
      applyFillToLayer(ui, layerId);
      return;
    }
    const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
    // An explore layer declared each feature's color: read the leaves lazily
    // (the click is the one O(N) read) and replay that snapshot, so Reset
    // returns the author's own per-feature paint. A feature without the
    // property restores its own default, never a neighbour's color. Other
    // layers keep the style-bag restore.
    const snapshot = readFeatureFillColors(layer);
    const hasAuthor = [...snapshot.values()].some(color => color !== null);
    if (hasAuthor) {
      walkFillLeaves(layer, node => {
        const color = snapshot.get(node);
        if (color === undefined || color === null) {
          restoreStyleDim(node, FACE.FILL);
          return;
        }
        const bag = styleBagOf(node);
        node.setStyle({
          fillColor: color,
          fillOpacity: bag?.fillOpacity ?? STYLE_BAG_DEFAULTS.fillOpacity,
          fill: true,
        });
      });
      return;
    }
    walkFillLeaves(layer, node => restoreStyleDim(node, FACE.FILL));
  },
  intentKeys: FILL_INTENT_KEYS,
  /** Content-change replay: a stored fill repaints the leaves that just
   *  landed — without it a streamed addData keeps the new features at the
   *  author's color and a running value fill classifies on stale breaks. The
   *  when-gate reads the SAME FILL_INTENT_KEYS array replayFillState's own
   *  loop reads, so the gate and the replay cannot drift: a new fill intent
   *  joins one array and is automatically both gated and replayed. The gate
   *  answers before any scheduler box is allocated. */
  contentChange: {
    kind: "frame",
    face: FACE.FILL,
    when: (ui, layerId) =>
      FILL_INTENT_KEYS.some(key => getIntent(ui, layerId, key) !== undefined) ||
      hasDeclaredValue(ui, layerId),
    run: (ui, layerId) => applyFillToLayer(ui, layerId),
  },
});

export {
  buildValueDetail,
  hasValueField,
  resolvedValue,
  valueFields,
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  disposeFillRow,
  FILL_DIMENSION,
  layerCanFill,
  replayDeclaredFill,
  replayFillState,
  resetLayerFill,
};
