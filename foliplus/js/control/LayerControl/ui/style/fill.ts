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
  applyValueFill,
  bindValueDetail,
  buildValueDetail,
  declaredFill,
  declaredValue,
  disposeFillRow,
  effectiveFillValue,
  hasDeclaredValue,
  hasValueField,
  resolveFillMode,
  resolvedValue,
  valueFields,
  valueForUi,
  writeFillMode,
} from "./fillValue.js";
import { buildOriginalDetail } from "./originalDetail.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  capabilityGate,
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { replayFace } from "./replay.js";
import { buildModeRow } from "./row.js";
import {
  FACE,
  STYLE_BAG_DEFAULTS,
  type StyleCarrier,
  cancelStyleDimApply,
  commitStyleDim,
  commitStyleDimMerged,
  flushStyleDimApply,
  restoreStyleDim,
  scheduleStyleDimApply,
  solidColorOf,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
  walkFillLeaves,
} from "./styleBag.js";
import {
  DIM,
  type LayerOverride,
  STYLE_MODE,
  type StyleMode,
  type ValueConfig,
  readFeatureFillColors,
} from "#core/layer/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { isHexColor } from "#platform/color.js";
import { dom } from "#platform/dom.js";
import { dropdownSurface } from "#platform/fullscreen.js";
import {
  STYLE_MODE_KEY,
  bindLiveColor,
  bindLiveNumber,
  dropdownOverlay,
  colorInput as formColorInput,
  formRow,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

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
const layerCanFill = capabilityGate("fill", "native");

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

  // Mode selection goes through the panel's resolver: an absent mode is solid,
  // a value config with no explicit mode is the pre-fillMode record shape (so
  // the config's presence alone means "paint by value"), and an explore layer
  // with neither is in the author's own original colors. The modes are mutually
  // exclusive on apply, even though every config stays stored (a mode switch
  // back must restore the other mode).
  // A declared value fill (#789) is a read-time default, so this mode can be "value"
  // with nothing in the intent store: `effectiveFillValue` is the same chain
  // the panel reads, so the map and the row cannot disagree about it.
  const value = effectiveFillValue(ui, layerId);
  const mode = displayFillMode(ui, layerId);

  if (mode === STYLE_MODE.VALUE && value !== undefined) {
    // A solid-color basemap has no leaves to classify, so a value fill degrades to
    // the authored pane paint instead of painting nothing.
    if (!isColorBasemap(layerInfo)) {
      // Paint the column the row shows: the stored config's field resolved
      // against the current data, the same rule `valueForUi` applies. The live
      // reader is that chain again, so the highlight pin replays the declared
      // value fill on mouseout instead of folium's flat author face.
      applyValueFill(
        ui,
        layerId,
        resolvedValue(ui, layerId, value)!,
        stored => resolvedValue(ui, layerId, stored)!,
        () => effectiveFillValue(ui, layerId),
      );
    }
    return;
  }

  // The original-colors mode owns no fill value: the author's per-feature paint
  // is the target, so the overrides are treated as absent and the walk below
  // restores each leaf's captured author face. They stay in the intent record
  // rather than being cleared, so a later switch back to solid still restores
  // the user's color and opacity.
  const original = mode === STYLE_MODE.ORIGINAL;
  const solid = mode === STYLE_MODE.SOLID;
  // SOLID owns exactly one colour. When no FILL_COLOR intent exists the base
  // colour is the layer's authored base — NOT each leaf's captured author bag,
  // which for a per-feature layer holds a different colour per leaf (restoring
  // it is the original mode's job, not solid's). The base is the same reader
  // the solid row's swatch uses (buildSolidDetail), so the panel and the map
  // cannot disagree about what "solid" means. Computed once and captured: the
  // highlight getter below replays the same value without a per-hover walk.
  // Only a per-feature layer needs the derivation: a uniform layer's author
  // face is already one colour, so no intent means no walk (an uncommitted
  // layer keeps folium's own hover handling and gains no listener). A
  // degenerate value record (mode=value, no config) and a colour basemap own
  // no derivable base either.
  const deriveSolidBase =
    solid && !isColorBasemap(layerInfo) && paintsPerFeatureFill(ui, layerId);
  const solidColor =
    getIntent(ui, layerId, INTENT.FILL_COLOR) ??
    (deriveSolidBase
      ? solidColorOf(ui, layerId, FACE.FILL, { excludeBasemap: true })
      : undefined);
  const color = original ? undefined : solidColor;
  const opacity = original ? undefined : getIntent(ui, layerId, INTENT.FILL_OPACITY);

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
  walkFillLeaves(layer, node => {
    const written = styleBagOf(node) !== undefined;
    // A leaf that was never written and has nothing to own is left alone: no
    // restore, no listener. An uncommitted layer keeps folium's own hover
    // handling and gains no per-leaf cost.
    if (!hasOverride && !written) return;
    // One `setStyle` per leaf, never a restore followed by a commit - the
    // two-call form wrote the same face twice per leaf, which doubled the DOM
    // and SVG attribute work on top of the walk.
    if (hasOverride && values.fillColor !== undefined) {
      // A color commit is minimal: it replaces every key the previous mode
      // could have left stale, and the user's opacity never arrives here
      // unset - `fillOpacity` is set on this same payload whenever the user
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
    // fires so the color survives the hover. `walkFillLeaves` already
    // guarantees a setStyle, so no isStyleSetter guard is needed here.
    // The "fill" key makes each commit replace this dimension's getter
    // instead of stacking a fresh closure.
    pinStyleOnHighlight(node, DIM.FILL, () => {
      // The author's own colors are the paint here: folium's mouseout restore
      // already put them back, so there is no user face to replay over it. The
      // mode is resolved, not read off the intent, because an explore layer
      // opens in it before any mode has been written.
      if (displayFillMode(ui, layerId) === STYLE_MODE.ORIGINAL) return null;
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
  const stored = getIntent(ui, layerId, INTENT.FILL_MODE);
  // One precedence chain, highest first:
  //   1. an explicit mode the user stored (INTENT.FILL_MODE);
  //   2. the author's declared value fill (#789) — a real instruction, so it
  //      outranks the presentation state detected from the author's paint;
  //   3. the detected per-feature state, the pre-fillMode record shape and
  //      the built-in fallback, in the order below.
  // (2) cannot shadow (1): `declaredFill` reads undefined the moment either
  // fill intent exists, so a stored mode is never overridden by a declaration.
  if (stored !== undefined) return stored;
  if (declaredValue(ui, layerId)) return STYLE_MODE.VALUE;
  if (!paintsPerFeatureFill(ui, layerId)) return resolveFillMode(ui, layerId, value);
  // A value config means the user already classified (the pre-fillMode record
  // shape). A lone fill color means the solid mode owns the paint — that is how
  // a record written before this mode existed still reads, and how a
  // programmatic color write lands. Opacity alone does not move the mode: it
  // rides both modes, and an explore layer with only an opacity override is
  // still painting its author's colors.
  if (value !== undefined) return STYLE_MODE.VALUE;
  if (getIntent(ui, layerId, INTENT.FILL_COLOR) !== undefined) return STYLE_MODE.SOLID;
  return STYLE_MODE.ORIGINAL;
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

  const storedOpacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);
  const opacityPct = (storedOpacity ?? base.fillOpacity ?? VISIBLE_FILL_OPACITY) * 100;
  const opacityInput = numberInput({
    value: opacityPct,
    min: 0,
    max: 100,
    step: 1,
    className: CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER,
    ariaLabel: ui.T("style_fill_opacity"),
  }) as HTMLInputElement;

  return [
    formRow(
      ui.T("style_fill"),
      inlineControls(colorInput, opacityInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  ];
};
/** Fill one detail slot for the active mode. Always disposes the previous
 *  scheme picker first: rebuilding the value detail must not leave a picker
 *  answering clicks for a trigger that no longer exists. */
const renderFillDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: StyleMode,
): void => {
  disposeFillRow(ui);
  detail.innerHTML = "";
  // The original-colors mode shows what the author declared and nothing
  // editable: the column (when a scale paired), the colors as one order, and
  // how many there are. No classification controls — those belong to the
  // user's own value fill.
  if (mode === STYLE_MODE.ORIGINAL) {
    detail.append(...buildOriginalDetail(ui, layerId));
    return;
  }
  if (mode === STYLE_MODE.VALUE && hasValueField(ui, layerId)) {
    const fields = valueFields(ui, layerId);
    detail.append(
      ...buildValueDetail(ui, layerId, fields, valueForUi(ui, layerId, fields)),
    );
    return;
  }
  detail.append(...buildSolidDetail(ui, layerId));
};
/** Build the fill form block. A layer with numeric fields gets the mode row
 *  (solid / color by value) plus the active mode's detail; a layer without one
 *  gets the solid controls only — there is nothing to classify, so offering a
 *  disabled "Color by value" option would just be noise. A color basemap keeps
 *  the pre-existing single swatch row: its fill is the pane paint, which has no
 *  per-feature values to classify. */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (isColorBasemap(layerInfo!)) {
    const colorInput = formColorInput({
      value: toHexColor(
        getIntent(ui, layerId, INTENT.FILL_COLOR) ?? CONST.COLOR.DEFAULT,
      ),
      className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
      ariaLabel: ui.T("style_fill"),
    }) as HTMLInputElement;
    const row = formRow(
      ui.T("style_fill"),
      dom.el("div", { class: "foliplus-form-inline" }, colorInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    );
    return dom.el(
      "div",
      { class: CONST.CLASSES.STYLE_FILL_BLOCK, "data-style-dim": "fill" },
      row,
    );
  }

  const perFeature = paintsPerFeatureFill(ui, layerId);
  // No value field (numeric or categorical) and no author record: one mode
  // only, so there is no mode to choose. The wrapper keeps the same
  // block/detail shape so a later field type can add a second mode without
  // moving the panel's bind seam. A layer the author paints per feature
  // keeps its mode row even without a value field: the read-only state still
  // needs the solid override beside it.
  if (!hasValueField(ui, layerId) && !perFeature) {
    const detail = dom.el("div", { class: CONST.CLASSES.STYLE_FILL_DETAIL });
    detail.append(...buildSolidDetail(ui, layerId));
    return dom.el(
      "div",
      { class: CONST.CLASSES.STYLE_FILL_BLOCK, "data-style-dim": "fill" },
      detail,
    );
  }

  // Opening on the original colors writes no intent: the map keeps the
  // author's own paint until the user edits a fill control, and the row states
  // what it is looking at. Once the user picks it, the choice is a stored mode
  // like the other two, so it can be left and come back to.
  const mode = displayFillMode(ui, layerId);
  // The three modes. "Original colors" is offered only while the author's
  // record still paints per feature: a layer the author did not paint that way
  // has no such state to return to, and an option that cannot paint would be a
  // dead entry. Solid stays selectable even when the mode had no numeric field
  // a moment ago.
  const options = [
    ...(perFeature
      ? [
          {
            value: STYLE_MODE.ORIGINAL,
            label: ui.T(STYLE_MODE_KEY.ORIGINAL),
            title: ui.T("style_fill_per_feature_note"),
          },
        ]
      : []),
    { value: STYLE_MODE.SOLID, label: ui.T(STYLE_MODE_KEY.SINGLE) },
    ...(hasValueField(ui, layerId)
      ? [{ value: STYLE_MODE.VALUE, label: ui.T(STYLE_MODE_KEY.BY_VALUE) }]
      : []),
  ];

  const {
    block: modeRow,
    select,
    detail,
  } = buildModeRow({
    label: ui.T("style_fill_mode"),
    selectClass: CONST.CLASSES.STYLE_FILL_MODE_SELECT,
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    detailClass: CONST.CLASSES.STYLE_FILL_DETAIL,
    value: mode,
    options,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });
  if (perFeature) {
    // The explanation lives on the control, not in the drawer: the select and
    // its original-colors option both carry the sentence as a
    // tooltip/description, so hovering or a screen reader still gets it while
    // the panel stays compact.
    const note = ui.T("style_fill_per_feature_note");
    select.title = note;
    select.setAttribute("aria-description", note);
  }

  renderFillDetail(ui, layerId, detail, mode);

  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_FILL_BLOCK, "data-style-dim": "fill" },
    modeRow,
    detail,
  );
};
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
    colorEl.onchange = ev => {
      prevColorChange?.call(colorEl, ev);
      flush();
    };
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
      onCommit: value => commitFillOpacity(ui, layerId, value),
    });
    // bindLiveNumber already owns onchange (clamp + commit); chain the flush
    // instead of overwriting it. blur is free.
    const flush = () => flushStyleDimApply(FACE.FILL, layerId, ui);
    const prevChange = opacityEl.onchange;
    opacityEl.onchange = ev => {
      prevChange?.call(opacityEl, ev);
      flush();
    };
    opacityEl.onblur = flush;
  }
};
/** Bind one detail slot for the active mode (solid color/opacity or the value
 *  controls). Called on open and again after every mode switch. */
const bindFillDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: StyleMode,
): void => {
  // The original-colors detail is a read-only readout: nothing to bind.
  if (mode === STYLE_MODE.ORIGINAL) return;
  if (mode === STYLE_MODE.VALUE && hasValueField(ui, layerId)) {
    bindValueDetail(ui, layerId, detail);
  } else {
    bindSolidDetail(ui, layerId, detail);
  }
};
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
  const detail = block.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_DETAIL}`,
  ) as HTMLElement;

  select.onchange = () => {
    // The mode the row was in before the browser moved the select's value. It
    // is resolved, not read off the select, so the fallback state (an explore
    // layer that has never been switched) is recognised as "original" too.
    const previous = displayFillMode(ui, layerId);
    const next: StyleMode =
      select.value === STYLE_MODE.VALUE
        ? STYLE_MODE.VALUE
        : select.value === STYLE_MODE.ORIGINAL
          ? STYLE_MODE.ORIGINAL
          : STYLE_MODE.SOLID;
    if (next === previous) return;
    writeFillMode(ui, layerId, next);
    // Leaving the original colors must repaint. The solid apply derives the
    // base colour itself (styleBaseOf) when no FILL_COLOR intent exists, so
    // the map takes the fill over without writing an intent the user never
    // chose — a seed would persist a fake "user picked this" colour that a
    // Reset would then show.
    renderFillDetail(ui, layerId, detail, next);
    bindFillDetail(ui, layerId, detail, next);
  };

  bindFillDetail(ui, layerId, detail, displayFillMode(ui, layerId));
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
    // event. Only when the stored border mode is follow-fill.
    if (getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE) === STYLE_MODE.FOLLOW_FILL) {
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
  valueSource: (ui, layerId) => {
    if (!layerCanFill(ui, layerId)) return "none";
    for (const key of FILL_INTENT_KEYS) {
      if (ui.intentStore.isUserSet(layerId, key)) return "user";
    }
    return "author";
  },
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
