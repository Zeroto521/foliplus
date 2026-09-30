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
// `"none"` and the gate rejects them naturally. A solid-colour basemap
// declares `"native"` — the pane's paint *is* the fill.
//
// UI chrome: shared `form.colorInput` + `bindLiveColor`, the same recipe as
// the HeatmapControl border row and the annotation label row — one
// <input type=color> inside a FORM_ROW, no reset button on the row itself
// (the panel-wide Reset handles it, the way label color has it).
import { METHOD } from "#core/classify.js";
import { numericPropertiesKeys } from "#core/fields.js";
import { CAP_TIER, DIM, GROUP, type LayerInfo } from "#core/layer/index.js";
import { DEFAULT_SCHEMES } from "#core/palette.js";
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
import type { FillRampConfig } from "../../type.js";
import { showSolidBasemap } from "../color.js";
import type { LayerUI } from "../index.js";
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import { applyRampToLayer } from "./fillRamp.js";
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
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";

/** The swatch's last resort when even the browser probe cannot resolve the
 *  authored color to a hex — black, matching an empty `<input type=color>`. */
const FILL_COLOR_DEFAULT = "#000000";

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
  const li = ui.m.layerRegistry.get(layerId);

  // By-value mode: delegate to the ramp renderer (two-pass walk + breaks).
  const ramp = getIntent(ui, layerId, INTENT.FILL_RAMP);
  if (ramp) {
    if (isColorBasemap(li)) return;
    applyRampToLayer(ui, layerId, ramp);
    return;
  }

  const color = getIntent(ui, layerId, INTENT.FILL_COLOR);
  const opacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);
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
  const values: Record<string, unknown> = {};
  if (color !== undefined) values.fillColor = color;
  if (opacity !== undefined) values.fillOpacity = opacity;
  walkStyleLeaves(layer, node => {
    // Shared write contract: value keys + visibility bit (`fill: true`).
    commitStyleDim(node, values, FACE.FILL);

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
  if (!ui.m.layerRegistry.has(layerId)) return;
  // Solid-color basemap: restore the authored default colour. No style-bag
  // face to replay — the pane's fill IS the basemap colour.
  if (isColorBasemap(ui.m.layerRegistry.get(layerId))) {
    cancelStyleDimApply(FACE.FILL, layerId);
    resetIntentKeys(ui, layerId, [INTENT.FILL_COLOR, INTENT.FILL_OPACITY]);
    ui.currentColor = CONST.COLOR.DEFAULT;
    showSolidBasemap(ui, CONST.COLOR.DEFAULT);
    return;
  }
  // Vector / other fillable carriers: descriptor reset owns intent+persist
  // and the styleBag restore walk.
  getDimension(DIM.FILL)!.reset!(ui, layerId);
};

/** Build a select element with the given options and current value. */
const buildSelect = (opts: {
  value: string;
  options: string[];
  className: string;
  ariaLabel: string;
}): HTMLSelectElement => {
  const sel = dom.el("select", {
    class: `foliplus-form-select ${opts.className}`,
    "aria-label": opts.ariaLabel,
    value: opts.value,
  }) as HTMLSelectElement;
  for (const opt of opts.options) {
    sel.appendChild(dom.el("option", { value: opt }, opt));
  }
  return sel;
};

/** Build the mode radio row (Solid | By value). Hidden for basemaps. */
const buildModeRadioRow = (
  ui: LayerUI,
  layerId: string,
  mode: "solid" | "ramp",
): HTMLElement => {
  const solidRadio = dom.el("input", {
    type: "radio",
    name: `fill-mode-${layerId}`,
    value: "solid",
    class: CONST.CLASSES.STYLE_FILL_MODE_RADIO,
    checked: mode === "solid" ? true : undefined,
  });
  const rampRadio = dom.el("input", {
    type: "radio",
    name: `fill-mode-${layerId}`,
    value: "ramp",
    class: CONST.CLASSES.STYLE_FILL_MODE_RADIO,
    checked: mode === "ramp" ? true : undefined,
  });
  return formRow(
    ui.T("style_fill"),
    inlineControls(
      dom.el("label", { class: "foliplus-form-label" }, solidRadio, "Solid"),
      dom.el("label", { class: "foliplus-form-label" }, rampRadio, "By value"),
    ),
    `${CONST.CLASSES.STYLE_FILL_ROW} ${CONST.CLASSES.STYLE_FILL_MODE_ROW}`,
  );
};

/** Build the solid-mode controls (color + opacity). */
const buildSolidControls = (
  ui: LayerUI,
  layerId: string,
  isBasemap: boolean,
): HTMLElement => {
  const storedColor = getIntent(ui, layerId, INTENT.FILL_COLOR);
  const color = toHexColor(
    storedColor ?? (isBasemap ? CONST.COLOR.DEFAULT : authoredFillColor(ui, layerId)),
  );
  const colorInput = formColorInput({
    value: color,
    className: CONST.CLASSES.STYLE_FILL_COLOR_INPUT,
    ariaLabel: ui.T("style_fill"),
  }) as HTMLInputElement;

  if (isBasemap) {
    return dom.el(
      "div",
      { class: CONST.CLASSES.STYLE_FILL_SOLID_CONTROLS },
      formRow(
        ui.T("style_fill"),
        dom.el("div", { class: "foliplus-form-inline" }, colorInput),
        CONST.CLASSES.STYLE_FILL_ROW,
      ),
    );
  }

  const storedOpacity = getIntent(ui, layerId, INTENT.FILL_OPACITY);
  const authoredOpacity = authoredFillOpacity(ui, layerId);
  const opacityPct = (storedOpacity ?? authoredOpacity ?? VISIBLE_FILL_OPACITY) * 100;
  const opacityInput = numberInput({
    value: opacityPct,
    min: 0,
    max: 100,
    step: 1,
    className: CONST.CLASSES.STYLE_FILL_OPACITY_NUMBER,
    ariaLabel: ui.T("style_fill_opacity"),
  }) as HTMLInputElement;

  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_FILL_SOLID_CONTROLS },
    formRow(
      ui.T("style_fill"),
      inlineControls(colorInput, opacityInput),
      CONST.CLASSES.STYLE_FILL_ROW,
    ),
  );
};

/** Build the ramp-mode controls (field, method, classes, scheme). */
const buildRampControls = (
  ui: LayerUI,
  layerId: string,
  ramp: FillRampConfig,
): HTMLElement => {
  const li = ui.m.layerRegistry.get(layerId);
  const layer = li?.layer as L.Layer | null;
  const fields = layer ? numericPropertiesKeys(layer) : [];

  const fieldSelect = buildSelect({
    value: ramp.field,
    options: fields,
    className: CONST.CLASSES.STYLE_FILL_RAMP_FIELD,
    ariaLabel: ui.T("style_fill_field"),
  });

  const methodSelect = buildSelect({
    value: ramp.method,
    options: Object.values(METHOD),
    className: CONST.CLASSES.STYLE_FILL_RAMP_METHOD,
    ariaLabel: ui.T("style_fill_method"),
  });

  const classOptions = Array.from({ length: 8 }, (_, i) => String(i + 2));
  const classesSelect = buildSelect({
    value: String(ramp.classes),
    options: classOptions,
    className: CONST.CLASSES.STYLE_FILL_RAMP_CLASSES,
    ariaLabel: ui.T("style_fill_classes"),
  });

  const schemeSelect = buildSelect({
    value: ramp.scheme,
    options: [...DEFAULT_SCHEMES],
    className: CONST.CLASSES.STYLE_FILL_RAMP_SCHEME,
    ariaLabel: ui.T("style_fill_scheme"),
  });

  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_FILL_RAMP_CONTROLS },
    formRow(ui.T("style_fill_field"), fieldSelect, CONST.CLASSES.STYLE_FILL_ROW),
    formRow(ui.T("style_fill_method"), methodSelect, CONST.CLASSES.STYLE_FILL_ROW),
    formRow(ui.T("style_fill_classes"), classesSelect, CONST.CLASSES.STYLE_FILL_ROW),
    formRow(ui.T("style_fill_scheme"), schemeSelect, CONST.CLASSES.STYLE_FILL_ROW),
  );
};

/** Build the fill form row: mode radio + solid controls + ramp controls. */
const buildFillRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const li = ui.m.layerRegistry.get(layerId);
  const isBasemap = isColorBasemap(li!);

  const ramp = getIntent(ui, layerId, INTENT.FILL_RAMP);
  const mode: "solid" | "ramp" = ramp ? "ramp" : "solid";

  const container = dom.el("div", {
    class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_FILL_ROW}`,
  });

  if (!isBasemap) {
    container.appendChild(buildModeRadioRow(ui, layerId, mode));
  }

  container.appendChild(buildSolidControls(ui, layerId, isBasemap));

  if (!isBasemap && mode === "ramp" && ramp) {
    container.appendChild(buildRampControls(ui, layerId, ramp));
  }

  return container;
};

/** Wire the fill row's mode radio + solid/ramp controls to commit paths. */
const bindFillRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const colorEl = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_COLOR_INPUT}`,
  ) as HTMLInputElement | null;
  if (colorEl) {
    bindLiveColor(colorEl, value => commitFillColor(ui, layerId, value));
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
    const flush = () => flushStyleDimApply(FACE.FILL, layerId);
    const prevChange = opacityEl.onchange;
    opacityEl.onchange = ev => {
      prevChange?.call(opacityEl, ev);
      flush();
    };
    opacityEl.onblur = flush;
  }

  // Mode radio: switch between solid and ramp modes
  const modeRadios = row.querySelectorAll(
    `.${CONST.CLASSES.STYLE_FILL_MODE_RADIO}`,
  ) as NodeListOf<HTMLInputElement>;
  modeRadios.forEach(radio => {
    radio.onchange = () => {
      if (!radio.checked) return;
      const newMode = radio.value === "ramp" ? "ramp" : "solid";
      if (newMode === "ramp") {
        const ramp: FillRampConfig = {
          field: "",
          method: METHOD.EQUAL,
          classes: 6,
          scheme: DEFAULT_SCHEMES[0],
        };
        getDimension(DIM.FILL)!.write!(ui, layerId, { mode: "ramp", ramp });
      } else {
        getDimension(DIM.FILL)!.write!(ui, layerId, { mode: "solid" });
      }
      row.innerHTML = "";
      row.appendChild(buildFillRow(ui, layerId));
      bindFillRow(ui, layerId, row);
    };
  });

  // Ramp controls: field, method, classes, scheme
  const rampField = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_RAMP_FIELD}`,
  ) as HTMLSelectElement | null;
  if (rampField) {
    rampField.onchange = () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return;
      const newRamp = { ...currentRamp, field: rampField.value };
      getDimension(DIM.FILL)!.write!(ui, layerId, { ramp: newRamp });
    };
  }

  const rampMethod = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_RAMP_METHOD}`,
  ) as HTMLSelectElement | null;
  if (rampMethod) {
    rampMethod.onchange = () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return;
      const newRamp = { ...currentRamp, method: rampMethod.value };
      getDimension(DIM.FILL)!.write!(ui, layerId, { ramp: newRamp });
    };
  }

  const rampClasses = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_RAMP_CLASSES}`,
  ) as HTMLSelectElement | null;
  if (rampClasses) {
    rampClasses.onchange = () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return;
      const newRamp = { ...currentRamp, classes: Number(rampClasses.value) };
      getDimension(DIM.FILL)!.write!(ui, layerId, { ramp: newRamp });
    };
  }

  const rampScheme = row.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_RAMP_SCHEME}`,
  ) as HTMLSelectElement | null;
  if (rampScheme) {
    rampScheme.onchange = () => {
      const currentRamp = getIntent(ui, layerId, INTENT.FILL_RAMP);
      if (!currentRamp) return;
      const newRamp = { ...currentRamp, scheme: rampScheme.value };
      getDimension(DIM.FILL)!.write!(ui, layerId, { ramp: newRamp });
    };
  }
};

/** Replay a layer's stored fill state (color + opacity) onto the map.
 *  Called from `applyUserState` on attach and late registration so a
 *  persisted value survives a reload. */
const replayFillState = (ui: LayerUI, id: string): void => {
  if (
    getIntent(ui, id, INTENT.FILL_COLOR) === undefined &&
    getIntent(ui, id, INTENT.FILL_OPACITY) === undefined &&
    getIntent(ui, id, INTENT.FILL_RAMP) === undefined
  ) {
    return;
  }
  applyFillToLayer(ui, id);
};

/** The fill dimension's resolved state. `mode` is derived from which
 *  intent is set: "ramp" when a fillRamp override exists, "solid" otherwise.
 *  The patch is `Partial<FillDimState>` — omitted keys leave that
 *  sub-dimension alone. */
type FillDimState = {
  mode: "solid" | "ramp";
  color: string;
  opacity: number | null;
  ramp: FillRampConfig | null;
};

/** Register fill as a per-layer dimension. The descriptor wires the existing
 *  helpers plus the intent+persist slots: `write` / `reset` own store +
 *  styleBag orchestration (cohesive `IntentStore.set` / `.clear`); the named
 *  `commitFillColor` / `commitFillOpacity` / `resetLayerFill` stay as thin
 *  delegates so panel call sites and tests keep their shape.
 *
 *  Registered ahead of `border` and `opacity` in `DIM_ORDER`
 *  (see `./registry.js`): fill comes first in the annotation panel's
 *  Layer section.
 *
 *  Dual mode (Solid | By value): `write` switches mode and clears the
 *  other side's intent + provenance (先清后写, T261 原子化纪律). The
 *  `reset` clears all three fill overrides (fillColor, fillOpacity,
 *  fillRamp) and restores the author's fill face. */
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
      color:
        getIntent(ui, layerId, INTENT.FILL_COLOR) ?? authoredFillColor(ui, layerId),
      opacity:
        getIntent(ui, layerId, INTENT.FILL_OPACITY) ?? authoredFillOpacity(ui, layerId),
    };
  },
  row: buildFillRow,
  /** Intent+persist + schedule the fill face landing. Handles mode
   *  switching (先清后写) and sub-dimension writes. */
  write: (ui, layerId, patch) => {
    const { mode: patchMode, color, opacity, ramp } = patch as Partial<FillDimState>;
    const currentMode: "solid" | "ramp" = getIntent(ui, layerId, INTENT.FILL_RAMP)
      ? "ramp"
      : "solid";
    const targetMode: "solid" | "ramp" =
      ramp !== undefined ? "ramp" : (patchMode ?? "solid");

    // Mutual exclusion: clear the other side before writing the new one.
    // Two-step (clear → write) within one synchronous call — saveState is
    // debounced, so the final state is persisted atomically.
    if (targetMode === "ramp" && currentMode === "solid") {
      cancelStyleDimApply(FACE.FILL, layerId);
      resetIntentKeys(ui, layerId, [INTENT.FILL_COLOR, INTENT.FILL_OPACITY]);
    } else if (targetMode === "solid" && currentMode === "ramp") {
      cancelStyleDimApply(FACE.FILL, layerId);
      resetIntentKeys(ui, layerId, [INTENT.FILL_RAMP]);
    }

    const writes: Array<readonly [IntentKey, unknown]> = [];
    if (color !== undefined) writes.push([INTENT.FILL_COLOR, color]);
    if (typeof opacity === "number") writes.push([INTENT.FILL_OPACITY, opacity]);
    if (ramp !== undefined) writes.push([INTENT.FILL_RAMP, ramp]);
    if (!writeIntentKeys(ui, layerId, writes)) return;
    scheduleFillApply(ui, layerId);
  },
  /** Cohesive reset: cancel trailing apply, clear all three fill overrides,
   *  save, restore the author's fill face from the style bag. */
  reset: (ui, layerId) => {
    cancelStyleDimApply(FACE.FILL, layerId);
    resetIntentKeys(ui, layerId, [
      INTENT.FILL_COLOR,
      INTENT.FILL_OPACITY,
      INTENT.FILL_RAMP,
    ]);
    const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
    walkStyleLeaves(layer, node => restoreStyleDim(node, FACE.FILL));
  },
  valueSource: (ui, layerId) => {
    if (!layerCanFill(ui, layerId)) return "none";
    if (
      ui.intentStore.isUserSet(layerId, INTENT.FILL_COLOR) ||
      ui.intentStore.isUserSet(layerId, INTENT.FILL_OPACITY) ||
      ui.intentStore.isUserSet(layerId, INTENT.FILL_RAMP)
    ) {
      return "user";
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
  isColorBasemap,
  layerCanFill,
  replayFillState,
  resetLayerFill,
};
