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
import { CLASS_COUNT, METHOD } from "#core/classify.js";
import { numericPropertiesKeys } from "#core/field.js";
import { CAP_TIER, DIM, type LayerInfo, ROLE } from "#core/layer/index.js";
import type { FillRampConfig, LayerOverride } from "#core/layer/intent.js";
import { DEFAULT_SCHEMES, getColorScale } from "#core/palette.js";
import { buildClassesRow, buildFieldRow, buildSchemeRow } from "#core/rampForm.js";
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
import { type SchemePicker, createSchemePicker } from "#common/schemePicker.js";
import { showSolidBasemap } from "../color.js";
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { applyRampToLayer, resolveFillMode } from "./fillRamp.js";
import { layerFields } from "./label.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { buildModeRow } from "./row.js";
import {
  FACE,
  type StyleCarrier,
  cancelStyleDimApply,
  commitStyleDim,
  commitStyleDimMerged,
  flushStyleDimApply,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
  walkFillLeaves,
} from "./styleBag.js";

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
  return Boolean(layerInfo.color) && layerInfo.role === ROLE.BASE;
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
  // The platform sanitizes every rejected value to `#000000` (and resolves a
  // name it knows), so the readback is always a valid simple color — no second
  // guard can ever fire here.
  return probe.value;
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
      // A colour commit is minimal: it replaces every key the previous arm
      // could have left stale, and the user's opacity never arrives here
      // unset - `fillOpacity` is set on this same payload whenever the user
      // has chosen one. Leaving the opacity unnamed keeps the author's value,
      // which is the only value on the leaf while no opacity is chosen.
      commitStyleDim(node, values, FACE.FILL);
    } else if (hasOverride) {
      // An opacity-only commit replaces nothing but the opacity, so the
      // previous arm's colour would ride under it: pull the author's keys
      // back in the same payload. The pin below replaces any ramp getter
      // still holding this leaf.
      commitStyleDimMerged(node, values, FACE.FILL, true);
    } else {
      // No override left: restore the author's face rather than skipping the
      // walk, or the previous arm's colour stays on the map until folium's
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

/** Fill mode values, one vocabulary for the select, the intent and the
 *  resolver. */
type FillMode = "solid" | "ramp";

/** The scheme picker owned by the open style panel. It installs
 *  document-level listeners while its listbox is open, so the panel must
 *  destroy it when it closes or rebuilds the ramp detail; one entry per UI
 *  because a map owns one LayerControl instance. */
const schemePickerByUi = new WeakMap<LayerUI, SchemePicker>();

/** Destroy the panel's scheme picker, if any. Idempotent; also called when a
 *  mode switch rebuilds the ramp detail so a stale picker cannot answer the
 *  next click. */
const disposeFillRow = (ui: LayerUI): void => {
  schemePickerByUi.get(ui)?.destroy();
  schemePickerByUi.delete(ui);
};

/** Numeric field names offered by the ramp field picker. The annotation
 *  panel's field cache is the primary source (it is already computed and
 *  invalidated with the layer's features); a tree walk is the fallback for a
 *  layer whose cache has not been populated yet. Order is first-seen, so the
 *  default option is stable across opens. */
const numericFields = (ui: LayerUI, layerId: string): string[] => {
  const cached = layerFields(ui, layerId)
    .filter(field => field.numeric)
    .map(field => field.name);
  if (cached.length > 0) return cached;
  // Snapshot-then-resolve, the same late-binding defense the fill applies
  // use: the registry's reference is stable once populated, and findLayer
  // re-resolves a folium layer whose registry reference is still null.
  const layerInfo = ui.c.layerRegistry.get(layerId);
  const layer = (layerInfo?.layer ?? ui.c.findLayer(layerId)) as L.Layer | null;
  return layer ? numericPropertiesKeys(layer) : [];
};

/** The ramp config a first switch to the by-value arm starts from. The field
 *  is the caller's first numeric field; the method/classes/scheme come from
 *  the shared bounds, so the first render and the persistence validator agree
 *  on what a legal record looks like. */
const defaultRampConfig = (field: string): FillRampConfig => ({
  kind: "numeric",
  field,
  method: CONST.RAMP.METHOD_DEFAULT,
  classes: CLASS_COUNT.DEFAULT,
  scheme: CONST.RAMP.SCHEME_DEFAULT,
});

/** The config the ramp detail should display and write from: the stored one
 *  when it exists (the inactive arm keeps it while the user is on solid),
 *  otherwise the defaults seeded from the first numeric field. A stored field
 *  the current data no longer offers is kept as-is — the apply already
 *  degrades to the author's face, and silently repainting on the next apply
 *  would be worse than showing the stored value. */
const rampForUi = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
): FillRampConfig => {
  const stored = getIntent(ui, layerId, INTENT.FILL_RAMP);
  if (stored) return stored;
  // Every caller reaches this line with a non-empty list: the detail only
  // renders the ramp arm when a numeric field exists, and the mode write
  // bails first when it does not.
  return defaultRampConfig(fields[0]);
};

/** Write the mode intent, seeding the ramp config when the user switches to
 *  the by-value arm and none is stored yet. Solid keeps whatever ramp config
 *  the other arm holds, so a switch back restores it. */
const writeFillMode = (ui: LayerUI, layerId: string, mode: FillMode): boolean => {
  if (mode === "solid") {
    getDimension(DIM.FILL)!.write!(ui, layerId, { mode });
    return true;
  }
  const fields = numericFields(ui, layerId);
  if (fields.length === 0) return false;
  getDimension(DIM.FILL)!.write!(ui, layerId, {
    mode,
    ramp: rampForUi(ui, layerId, fields),
  });
  return true;
};

/** Display label for one classification method. Written as literal T()
 *  calls rather than `T(\`style_method_\${method}\`)`: the locale-usage scanner
 *  only sees literal keys, and a template-built key would let a renamed locale
 *  entry pass silently. */
const methodLabel = (ui: LayerUI, method: FillRampConfig["method"]): string => {
  switch (method) {
    case METHOD.JENKS:
      return ui.T("style_method_jenks");
    case METHOD.QUANTILE:
      return ui.T("style_method_quantile");
    case METHOD.EQUAL:
      return ui.T("style_method_equal");
    case METHOD.HEADS:
      return ui.T("style_method_heads");
  }
};

/** Merge one ramp-detail change into the stored config and schedule the
 *  per-leaf repaint through the dimension write. Returns the config that was
 *  written so the caller can keep the controls in sync. */
const writeFillRamp = (
  ui: LayerUI,
  layerId: string,
  patch: Partial<FillRampConfig>,
): FillRampConfig => {
  const fields = numericFields(ui, layerId);
  const next: FillRampConfig = { ...rampForUi(ui, layerId, fields), ...patch };
  getDimension(DIM.FILL)!.write!(ui, layerId, { mode: "ramp", ramp: next });
  return next;
};

/** The solid arm's detail: one row holding the colour swatch and the
 *  fill-opacity number side by side (the border-row recipe). Colour and
 *  opacity are one idea — a fill without either half is rarely what the user
 *  means — so the arm stays on a single line instead of two stacked rows. */
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

/** The ramp arm's detail rows, built from the shared `core/rampForm`
 *  primitives: the heatmap panel and this panel therefore share the row
 *  structure, the control types (native selects) and the option vocabularies
 *  (method order + 2..9 class counts from #core/classify). The scheme trigger
 *  shows the colour strip only, matching the heatmap trigger. */
const buildRampDetail = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
  ramp: FillRampConfig,
): HTMLElement[] => {
  const field = buildFieldRow({
    label: ui.T("style_fill_field"),
    ariaLabel: ui.T("style_fill_field"),
    fields,
    value: fields.includes(ramp.field) ? ramp.field : fields[0],
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    selectClass: CONST.CLASSES.STYLE_FILL_FIELD_SELECT,
  });

  const classes = buildClassesRow({
    // The row reads by its primary control: the classification method, the same
    // visible label the heatmap panel uses (classify_method). The class count
    // keeps its own accessible name (see classesAriaLabel below) so the two
    // selects stay distinguishable.
    label: ui.T("style_method"),
    methodAriaLabel: ui.T("style_method"),
    classesAriaLabel: ui.T("style_fill_classes"),
    methodValue: ramp.method,
    classesValue: ramp.classes,
    methodLabel: method => methodLabel(ui, method),
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    methodClass: CONST.CLASSES.STYLE_FILL_METHOD_SELECT,
    classesClass: CONST.CLASSES.STYLE_FILL_CLASSES_SELECT,
  });

  const scheme = buildSchemeRow({
    label: ui.T("style_fill_scheme"),
    triggerClass: CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER,
    barClass: CONST.CLASSES.STYLE_FILL_SCHEME_BAR,
    hiddenClass: CONST.CLASSES.STYLE_FILL_SCHEME_HIDDEN,
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
  });

  return [field.row, classes.row, scheme.row];
};

/** Fill one detail slot for the active arm. Always disposes the previous
 *  scheme picker first: rebuilding the ramp detail must not leave a picker
 *  answering clicks for a trigger that no longer exists. */
const renderFillDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: FillMode,
): void => {
  disposeFillRow(ui);
  detail.innerHTML = "";
  const fields = numericFields(ui, layerId);
  if (mode === "ramp" && fields.length > 0) {
    detail.append(
      ...buildRampDetail(ui, layerId, fields, rampForUi(ui, layerId, fields)),
    );
    return;
  }
  detail.append(...buildSolidDetail(ui, layerId));
};

/** Build the fill form block. A layer with numeric fields gets the mode row
 *  (solid / color by value) plus the active arm's detail; a layer without one
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
    return formRow(
      ui.T("style_fill"),
      dom.el("div", { class: "foliplus-form-inline" }, colorInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    );
  }

  const fields = numericFields(ui, layerId);
  // No numeric field: one arm only, so there is no mode to choose. The
  // wrapper keeps the same block/detail shape so a later categorical field
  // type can add a second arm without moving the panel's bind seam.
  if (fields.length === 0) {
    const detail = dom.el("div", { class: CONST.CLASSES.STYLE_FILL_DETAIL });
    detail.append(...buildSolidDetail(ui, layerId));
    return dom.el("div", { class: CONST.CLASSES.STYLE_FILL_BLOCK }, detail);
  }

  const storedMode = resolveFillMode(
    ui,
    layerId,
    getIntent(ui, layerId, INTENT.FILL_RAMP),
  );
  const mode: FillMode = storedMode === "ramp" ? "ramp" : "solid";

  const { block: modeRow, detail } = buildModeRow({
    label: ui.T("style_fill_mode"),
    selectClass: CONST.CLASSES.STYLE_FILL_MODE_SELECT,
    rowClass: CONST.CLASSES.STYLE_FILL_ROW,
    detailClass: CONST.CLASSES.STYLE_FILL_DETAIL,
    value: mode,
    options: [
      { value: "solid", label: ui.T("style_fill_single") },
      { value: "ramp", label: ui.T("style_fill_by_value") },
    ],
  });

  renderFillDetail(ui, layerId, detail, mode);

  return dom.el("div", { class: CONST.CLASSES.STYLE_FILL_BLOCK }, modeRow, detail);
};

/** Bind the solid arm's two live controls. */
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

/** Bind the ramp arm's three controls, including the shared scheme picker.
 *
 *  Every element is built by `buildRampDetail` immediately above, so the
 *  queries cast instead of re-testing for null: a guard here could never take
 *  its false arm (the markup is a private contract) and would just read as an
 *  uncovered branch. The picker is created first so the class-count commit can
 *  update it directly (its strip has one block per class). */
const bindRampDetail = (ui: LayerUI, layerId: string, detail: HTMLElement): void => {
  const trigger = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
  ) as HTMLElement;
  const hidden = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_HIDDEN}`,
  ) as HTMLSelectElement;
  const fields = numericFields(ui, layerId);
  const ramp = rampForUi(ui, layerId, fields);
  const picker = createSchemePicker({
    trigger,
    hiddenSelect: hidden,
    schemes: DEFAULT_SCHEMES,
    value: ramp.scheme,
    numClasses: ramp.classes,
    portal: true,
    label: ui.T("style_fill_scheme"),
    colorScale: getColorScale,
    onChange: name => {
      writeFillRamp(ui, layerId, { scheme: name });
    },
  });
  schemePickerByUi.set(ui, picker);

  const fieldSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
  ) as HTMLSelectElement;
  fieldSelect.onchange = () => writeFillRamp(ui, layerId, { field: fieldSelect.value });

  const methodSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
  ) as HTMLSelectElement;
  methodSelect.onchange = () =>
    writeFillRamp(ui, layerId, {
      method: methodSelect.value as FillRampConfig["method"],
    });

  const classesSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
  ) as HTMLSelectElement;
  classesSelect.onchange = () => {
    const next = writeFillRamp(ui, layerId, {
      classes: parseInt(classesSelect.value, 10),
    });
    // The strip has one block per class: keep the picker's preview in step
    // with the count the map is now using.
    picker.setNumClasses(next.classes);
  };
};

/** Bind one detail slot for the active arm (solid color/opacity or the ramp
 *  controls). Called on open and again after every mode switch. */
const bindFillDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: FillMode,
): void => {
  if (mode === "ramp" && numericFields(ui, layerId).length > 0) {
    bindRampDetail(ui, layerId, detail);
  } else {
    bindSolidDetail(ui, layerId, detail);
  }
};

/** Wire the fill block: the mode select switches arms in place (rebuilding the
 *  detail slot), and the active arm's controls commit through the dimension's
 *  write path. A color basemap row or a layer with one arm (no numeric field)
 *  has no mode select and only owns the solid controls. */
const bindFillRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const block = row.closest(`.${CONST.CLASSES.STYLE_FILL_BLOCK}`) as HTMLElement | null;
  if (!block) {
    // Color basemap: the single swatch row, no arms.
    bindSolidDetail(ui, layerId, row);
    return;
  }

  const select = block.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_MODE_SELECT}`,
  ) as HTMLSelectElement | null;
  if (!select) {
    // One honest arm: no mode row to switch; bind the solid controls only.
    bindSolidDetail(ui, layerId, block);
    return;
  }
  const detail = block.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_DETAIL}`,
  ) as HTMLElement;

  select.onchange = () => {
    // The mode row only renders when a numeric field exists, so both arms are
    // honest and the write cannot be rejected.
    const next: FillMode = select.value === "ramp" ? "ramp" : "solid";
    writeFillMode(ui, layerId, next);
    renderFillDetail(ui, layerId, detail, next);
    bindFillDetail(ui, layerId, detail, next);
  };

  bindFillDetail(ui, layerId, detail, select.value === "ramp" ? "ramp" : "solid");
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
    cancelStyleDimApply(FACE.FILL, layerId, ui);
    resetIntentKeys(ui, layerId, FILL_INTENT_KEYS);
    const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
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
   *  author's colour and a running ramp classifies on stale breaks. The
   *  when-gate reads the SAME FILL_INTENT_KEYS array replayFillState's own
   *  loop reads, so the gate and the replay cannot drift: a new fill intent
   *  joins one array and is automatically both gated and replayed. The gate
   *  answers before any scheduler box is allocated. */
  contentChange: {
    kind: "frame",
    face: FACE.FILL,
    when: (ui, layerId) =>
      FILL_INTENT_KEYS.some(key => getIntent(ui, layerId, key) !== undefined),
    run: (ui, layerId) => applyFillToLayer(ui, layerId),
  },
});

export {
  applyFillToLayer,
  bindFillRow,
  buildFillRow,
  commitFillColor,
  commitFillOpacity,
  disposeFillRow,
  FILL_DIMENSION,
  layerCanFill,
  replayFillState,
  resetLayerFill,
};
