// Border row — the ⚙️ drawer's "Layer" section stroke swatch + width.
//
// A self-managed LayerControl dimension (like label color, not like opacity
// or zoom range): the values live in `ui.intentStore` borderColor /
// borderWeight, are persisted under `layerState.borderColor` /
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
import { CAP_TIER, DIM } from "#core/layer/index.js";
import { findLeaf } from "#core/layer/walkLeaf.js";
import { dom } from "#common/dom.js";
import {
  BORDER_WEIGHT,
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#common/form.js";
import * as CONST from "../../const.js";
import type { BorderRowBindTarget, BorderRowBuildTarget } from "../../type.js";
import type { LayerUI } from "../index.js";
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { OverlayPanel } from "../overlayPanel.js";
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
  type StyleSetter,
  cancelStyleDimApply,
  commitStyleDim,
  flushStyleDimApply,
  isStyleSetter,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";

/** Whether the layer's surface can honestly carry a border write.
 *  Pure capability check: `capabilities.stroke === "native"`.
 *
 *  The stroke capability is probe-derived at the surface (see
 *  `detectCapabilities` in core/layer/LayerSurface.ts) — a layer whose
 *  tree has no `setStyle` leaf declares `"none"`, so the gate rejects
 *  it naturally. Canvas layers, MarkerCluster, GridLayer / ImageOverlay,
 *  and the colour basemap all declare `"none"` for stroke. No extra
 *  checks belong here: the invariant is that `gate` is exactly the
 *  capability check, no carrier probes, no `isColorBasemap`
 *  special-cases, no canvas exclusion. */
const layerCanBorder = (ui: LayerUI, layerId: string): boolean => {
  const li = ui.m.layerRegistry.get(layerId);
  if (!li) return false;
  return ui.m.surfaceFor(li).capabilities.stroke === CAP_TIER.NATIVE;
};

/** Leaflet's own default `Path.color` — folium's style function always
 *  populates `options.color`, so this only fires for a bare Leaflet layer
 *  with no style declaration at all. */
const STYLE_BORDER_DEFAULT = "#3388ff";

/** The first leaf that carries a style — the row's initial value is read
 *  from it, so a swatch or a number field never shows a value the layer is
 *  not actually painting.
 *
 *  Groups are always descended, never returned. L.GeoJSON defines `setStyle`
 *  itself — it fans the style out to its features — so a setter-only check
 *  stops at the group and reads its own options, which hold only the style
 *  function: the panel then shows Leaflet's defaults instead of the author's
 *  stroke, which is the stroke the layer is actually painting. */
const firstCarrier = (node: StyleCarrier): StyleSetter | null =>
  findLeaf<StyleSetter>(node, leaf => (isStyleSetter(leaf) ? leaf : undefined)) ?? null;

/** The authored border of one layer, or the Leaflet defaults for a layer
 *  that has no declared style. Reads the captured base first —`setStyle`
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
  const bag = carrier ? styleBagOf(carrier) : undefined;
  return {
    color: bag?.color ?? carrier?.options?.color ?? STYLE_BORDER_DEFAULT,
    weight: bag?.weight ?? carrier?.options?.weight ?? BORDER_WEIGHT.DEFAULT,
  };
};

/** Commit the current border color and width to the layer. Walks the layer
 *  tree and calls `setStyle({color?, weight?, stroke: true})` once per leaf
 *  that has a setter — the two sub-dimensions ride the same call so a color
 *  change and a width change can never disagree about the stroke. A node
 *  without a setter is skipped silently.
 *
 *  Reads both values from the UI maps; a sub-dimension not in the map is
 *  omitted from the `setStyle` call so the author's declared default stays
 *  in force. `stroke: true` is always included: the user chose a border, so
 *  the write must make it visible even when the author declared
 *  `stroke: false` (quickstart Facility Points). Reset restores the author's
 *  stroke flag from the captured base.
 *
 *  Called from the two commit paths and from the applyUserState sweep, so
 *  the walk is the single writer of a border style — the commits only record
 *  intent. */
const applyBorderToLayer = (ui: LayerUI, layerId: string): void => {
  const color = getIntent(ui, layerId, INTENT.BORDER_COLOR);
  const weight = getIntent(ui, layerId, INTENT.BORDER_WEIGHT);
  if (color === undefined && weight === undefined) return;
  const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
  if (!layer) return;
  const values: Record<string, unknown> = {};
  if (color !== undefined) values.color = color;
  if (weight !== undefined) values.weight = weight;
  // Groups are descended, never written: walkStyleLeaves filters to leaves
  // that own setStyle, so a group's style function (L.GeoJSON, L.FeatureGroup)
  // never captures the base in place of its features.
  walkStyleLeaves(layer, node => {
    // Shared write contract: value keys + visibility bit (`stroke: true`).
    commitStyleDim(node, values, FACE.STROKE);
    // Pin the leaf's stroke against folium's highlight restore via the shared
    // pinStyleOnHighlight hook, keyed "border" so a re-commit
    // replaces this dimension's getter instead of stacking another closure.
    // The fill row pins under its own key on the same leaf: one shared
    // mouseout handler merges both dimensions into a single setStyle, so a
    // highlight-restore can neither drop one dimension nor grow a getter
    // list with every commit.
    pinStyleOnHighlight(node, DIM.BORDER, () => {
      const c = getIntent(ui, layerId, INTENT.BORDER_COLOR);
      const w = getIntent(ui, layerId, INTENT.BORDER_WEIGHT);
      if (c === undefined && w === undefined) return null;
      // stroke:true rides the replay too — folium's resetStyle would
      // otherwise re-apply the author's stroke:false on mouseout and hide
      // the user's border the moment the pointer leaves.
      return styleDimPayload({ color: c, weight: w }, FACE.STROKE);
    });
  });
};

/** Shared apply scheduler (styleBag, face=`stroke`): one walk per frame.
 *  The wrapper exists only to bind this face's apply fn — flush / drop /
 *  has go straight to styleBag at the call site. */
const scheduleBorderApply = (ui: LayerUI, layerId: string): void => {
  scheduleStyleDimApply(FACE.STROKE, layerId, () => applyBorderToLayer(ui, layerId));
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
  if (getIntent(ui, layerId, INTENT.BORDER_COLOR) === color) return;
  getDimension(DIM.BORDER)!.write!(ui, layerId, { color });
};

/** Commit the border width to the layer. Called from `bindLiveNumber` on the
 *  width input, which already clamps into the shared bounds. */
const commitBorderWeight = (ui: LayerUI, layerId: string, weight: number): void => {
  if (getIntent(ui, layerId, INTENT.BORDER_WEIGHT) === weight) return;
  getDimension(DIM.BORDER)!.write!(ui, layerId, { weight });
};

/** Reset one layer's border to its authored value and drop its persisted
 *  entry. "Authored" means the base captured on first write —`setStyle`
 *  mutates `options` in place, so the captured value is the only source of
 *  truth for the author's stroke by reset time.
 *
 *  Both sub-dimensions are restored from the captured base, and the
 *  persisted overrides are removed either way so the next load does not
 *  re-apply a stroke the layer no longer shows. */
const resetLayerBorder = (ui: LayerUI, layerId: string): void => {
  if (!ui.m.layerRegistry.has(layerId)) return;
  // Descriptor reset owns cancel + intent clear + styleBag restore walk.
  getDimension(DIM.BORDER)!.reset!(ui, layerId);
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

const colorSelector = (className?: string) =>
  className ? `input.${className}` : "input[type=color]";
const weightSelector = (className?: string) =>
  className ? `input.${className}` : "input[type=number]";

const buildBorderRowShell = (target: BorderRowBuildTarget): HTMLElement => {
  const parts: HTMLElement[] = [];
  if (target.hasColorInput) {
    parts.push(
      colorInput({
        value: target.color,
        className: target.className,
        ariaLabel: target.colorAria,
      }),
    );
  }
  if (target.hasWeightInput) {
    parts.push(
      numberInput({
        value: target.weight,
        min: BORDER_WEIGHT.MIN,
        max: BORDER_WEIGHT.MAX,
        step: BORDER_WEIGHT.STEP,
        className: target.weightClassName,
        ariaLabel: target.weightAria,
      }),
    );
  }
  return dom.el(
    "div",
    { class: target.rowClass },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, target.label),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, inlineControls(...parts)),
  );
};

const bindBorderRowShell = (row: HTMLElement, target: BorderRowBindTarget): void => {
  const colorEl = row.querySelector(
    colorSelector(target.className),
  ) as HTMLInputElement | null;
  if (colorEl && target.onChangeColor) {
    bindLiveColor(colorEl, value => target.onChangeColor?.(value));
    // Chain, never overwrite: bindLiveColor only owns oninput today, but a
    // future binder that owns onchange must not be dropped. Same flush
    // contract as fill — the trailing rAF frame must land at drag end.
    if (target.onFlush) {
      const flush = target.onFlush;
      const prevColorChange = colorEl.onchange;
      colorEl.onchange = ev => {
        prevColorChange?.call(colorEl, ev);
        flush();
      };
      colorEl.onblur = () => flush();
    }
  }
  const weightEl = row.querySelector(
    weightSelector(target.weightClassName),
  ) as HTMLInputElement | null;
  if (weightEl && target.onChangeWeight) {
    bindLiveNumber(weightEl, {
      min: BORDER_WEIGHT.MIN,
      max: BORDER_WEIGHT.MAX,
      fallback: BORDER_WEIGHT.DEFAULT,
      onCommit: value => target.onChangeWeight?.(value),
    });
    if (target.onFlush) {
      const flush = target.onFlush;
      const prevWeightChange = weightEl.onchange;
      weightEl.onchange = ev => {
        prevWeightChange?.call(weightEl, ev);
        flush();
      };
      weightEl.onblur = () => flush();
    }
  }
};

/** Build the border form row: color swatch + width number input. Delegates
 *  to `buildBorderRowShell` — same shell as the delegated drawer's border
 *  row, so the two read identically — with the vector write target:
 *  `commitBorderColor` / `commitBorderWeight` on every commit.
 *
 *  Each input's initial value is the stored choice, falling back to the
 *  author's own `options` — never a constant — so the row shows what the
 *  layer is actually painting on first open. The color is resolved to the
 *  swatch's own form by `displayColor` before it reaches the field. */
const buildBorderRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const author = authoredBorder(ui, layerId);
  return buildBorderRowShell({
    rowClass: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_BORDER_ROW}`,
    label: ui.T("border"),
    color: displayColor(getIntent(ui, layerId, INTENT.BORDER_COLOR) ?? author.color),
    weight: getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight,
    hasColorInput: true,
    hasWeightInput: true,
    className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
    weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
    colorAria: ui.T("style_border_color"),
    weightAria: ui.T("style_border_weight"),
  });
};

/** Wire the shared live-color and live-number binders to this row's commit
 *  paths. Called from `openStylePanel`. */
const bindBorderRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  bindBorderRowShell(row, {
    className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
    weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
    onChangeColor: value => commitBorderColor(ui, layerId, value),
    onChangeWeight: value => commitBorderWeight(ui, layerId, value),
    onFlush: () => flushStyleDimApply(FACE.STROKE, layerId),
  });
};

/** Register border as a per-layer dimension. The descriptor wires the existing
 *  helpers plus the intent+persist slots: `write` / `reset` own store +
 *  styleBag orchestration (cohesive `LayerIntentStore.set` / `.clear`); the named
 *  `commitBorderColor` / `commitBorderWeight` / `resetLayerBorder` stay as
 *  thin delegates so panel call sites and tests keep their shape.
 *
 *  Registered ahead of `opacity` and `zoomRange` in `DIM_ORDER`
 *  (see `./registry.js`): border comes second in the annotation panel's
 *  Layer section, right after fill. */
const BORDER_DIMENSION = registerDimension<{ color: string; weight: number }>({
  key: DIM.BORDER,
  gate: layerCanBorder,
  value: (ui, layerId) => {
    const li = ui.m.layerRegistry.get(layerId);
    if (!li) return undefined;
    const author = authoredBorder(ui, layerId);
    return {
      color: getIntent(ui, layerId, INTENT.BORDER_COLOR) ?? author.color,
      weight: getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight,
    };
  },
  row: buildBorderRow,
  /** Intent+persist + schedule the stroke face landing. `patch` is already
   *  normalized. Omitted keys leave that sub-dimension alone. */
  write: (ui, layerId, patch) => {
    const { color, weight } = patch;
    const writes: Array<readonly [IntentKey, unknown]> = [];
    if (color !== undefined) writes.push([INTENT.BORDER_COLOR, color]);
    if (weight !== undefined) writes.push([INTENT.BORDER_WEIGHT, weight]);
    if (!writeIntentKeys(ui, layerId, writes)) return;
    scheduleBorderApply(ui, layerId);
  },
  /** Cohesive reset: cancel trailing apply, clear both border overrides,
   *  save, restore the author's stroke face from the style bag. */
  reset: (ui, layerId) => {
    cancelStyleDimApply(FACE.STROKE, layerId);
    resetIntentKeys(ui, layerId, [INTENT.BORDER_COLOR, INTENT.BORDER_WEIGHT]);
    const layer = ui.m.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
    // Same restore walk as fill — one styleBag contract, not two copies.
    walkStyleLeaves(layer, node => restoreStyleDim(node, FACE.STROKE));
  },
  valueSource: (ui, layerId) => {
    if (!layerCanBorder(ui, layerId)) return "none";
    if (
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_COLOR) ||
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_WEIGHT)
    ) {
      return "user";
    }
    return "author";
  },
});

export {
  applyBorderToLayer,
  authoredBorder,
  bindBorderRow,
  bindBorderRowShell,
  BORDER_DIMENSION,
  buildBorderRow,
  buildBorderRowShell,
  commitBorderColor,
  commitBorderWeight,
  layerCanBorder,
  resetLayerBorder,
};
