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
// label label row, so a border row reads identically whether the layer
// paints through `setStyle` or through a component's own canvas.
import { INTENT, type IntentKey, getIntent } from "../intent.js";
import type { LayerUI } from "../surface.js";
import { buildValueDetail, hasValueField, resolvedValue, valueFields } from "./fill.js";
import { paintsPerFeatureFill } from "./fillAuthor.js";
import { valueSchemeForUi, valueSchemes } from "./fillValue.js";
import { buildOriginalDetail } from "./originalDetail.js";
import { pinStyleOnHighlight } from "./pin.js";
import {
  capabilityGate,
  getDimension,
  registerDimension,
  resetIntentKeys,
  writeIntentKeys,
} from "./registry.js";
import { registerFaceReplay } from "./replay.js";
import { buildModeRow } from "./row.js";
import { applyValueStroke, resolveStrokeMode } from "./strokeValue.js";
import {
  FACE,
  type StyleCarrier,
  type StyleSetter,
  cancelStyleDimApply,
  commitStyleDim,
  commitStyleDimMerged,
  flushStyleDimApply,
  restoreStyleDim,
  scheduleStyleDimApply,
  styleBagOf,
  styleBaseOf,
  styleDimPayload,
  walkStyleLeaves,
} from "./styleBag.js";
import {
  DIM,
  FILL_MODE,
  type FillMode,
  GEOM_TYPE,
  type ValueConfig,
} from "#core/layer/index.js";
import { OVERLAY_IDS, ensureOverlayRegistry } from "#core/overlay/index.js";
import {
  CATEGORY_SCHEMES,
  CLASS_COUNT,
  CLASS_COUNT_VALUES,
  DEFAULT_SCHEMES,
  VALUE_KIND,
  getColorScale,
  inferFieldKind,
} from "#core/value/index.js";
import { dom } from "#platform/dom.js";
import {
  dropdownSurface,
  fullscreenSurface,
  onFullscreenSurfaceChange,
} from "#platform/fullscreen.js";
import {
  BORDER_WEIGHT,
  PANEL_CLASS,
  STYLE_MODE,
  type SchemePicker,
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  createSchemePicker,
  dropdownOf,
  dropdownOverlay,
  inlineControls,
  normalizeHexColor,
  numberInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** Shared border-row shell. Two callers — the vector `buildBorderRow`
 *  (which supplies `setStyle` chrome + hooks) and the delegated drawer's
 *  `buildBorderRow` (which supplies plain chrome + `styleSetters` write
 *  target) — both need a color swatch plus a width number input wired to a
 *  live commit path. The shell owns the row DOM and the bind recipe; the
 *  caller supplies its own chrome and write callbacks.
 *
 *  `buildBorderRowShell` and `bindBorderRowShell` take separate targets:
 *  the build side needs shell/chrome options, the bind side needs write
 *  callbacks. Folding them into one target would force the bind caller to
 *  supply dummy shell fields and vice versa. */
interface BorderRowBuildTarget {
  /** Resolved row label text. */
  label: string;
  /** Row `class` — `FORM_ROW` plus any caller-specific hook. */
  rowClass: string;
  /** Initial color value (already display-ready for the swatch). */
  color?: string;
  /** Initial width value. */
  weight: number;
  /** Present iff a color input should render. */
  hasColorInput?: boolean;
  /** Present iff a width input should render. */
  hasWeightInput?: boolean;
  /** Optional color input `class`. */
  className?: string;
  /** Optional weight input `class`. */
  weightClassName?: string;
  /** Optional aria-label for the color swatch. */
  colorAria?: string;
  /** Optional aria-label for the width input. */
  weightAria?: string;
  /** Render the color input inert (the author's own stroke in ORIGINAL mode).
   *  Same swatch control as the editable mode, so the row stays pixel-identical
   *  and only its editability differs. Absent = editable. */
  colorReadOnly?: boolean;
}

interface BorderRowBindTarget {
  /** Write callback for the color input. */
  onChangeColor?: (value: string) => void;
  /** Write callback for the width input. */
  onChangeWeight?: (value: number) => void;
  /** Drag-end hook: change / blur must flush a deferred apply walk. */
  onFlush?: () => void;
  /** Same class hook the build side used on the color input. */
  className?: string;
  /** Same class hook the build side used on the weight input. */
  weightClassName?: string;
}

/** Whether the layer's surface can honestly carry a border write.
 *  Pure capability check: `capabilities.stroke === "native"`.
 *
 *  The stroke capability is probe-derived at the surface (see
 *  `detectCapabilities` in core/layer/LayerSurface.ts) — a layer whose
 *  tree has no `setStyle` leaf declares `"none"`, so the gate rejects
 *  it naturally. Canvas layers, MarkerCluster, GridLayer / ImageOverlay,
 *  and the color basemap all declare `"none"` for stroke. No extra
 *  checks belong here: the invariant is that `gate` is exactly the
 *  capability check, no carrier probes, no `isColorBasemap`
 *  special-cases, no canvas exclusion. */
const layerCanBorder = capabilityGate("stroke", "native");

/** The authored border of one layer, or the Leaflet defaults for a layer
 *  that has no declared style. Reads the captured base first — `setStyle`
 *  mutates `options` in place, so after a write the layer's own options no
 *  longer hold the author's stroke and the base is the only copy. Never
 *  reads the user's stored value, so a stored value cannot feed back into
 *  the base and make a Reset restore the user's own choice. Delegates to
 *  `styleBaseOf` so the border and fill rows share one reader. */
const authoredBorder = (
  ui: LayerUI,
  layerId: string,
): { color: string; weight: number } => {
  const base = styleBaseOf(ui, layerId);
  return { color: base.color, weight: base.weight };
};
const BORDER_INTENT_KEYS: readonly IntentKey[] = [
  INTENT.BORDER_COLOR,
  INTENT.BORDER_WEIGHT,
  INTENT.BORDER_VALUE,
  INTENT.BORDER_STYLE_MODE,
];

/** The scheme picker owned by the open style panel's border value detail.
 *  One entry per UI (a map owns one LayerControl instance); the panel must
 *  destroy it when it closes or rebuilds the detail, or a stale picker
 *  answers the next click. Mirrors fill's per-UI picker slot. */
const borderSchemePickerByUi = new WeakMap<LayerUI, SchemePicker>();
/** Unregister for the picker's overlay-registry entry (one per UI). */
const borderSchemeOverlayByUi = new WeakMap<LayerUI, () => void>();

/** The border's value config — the config the stroke classifies by.
 *
 *  The border owns its value independently of the fill face: no cross-face
 *  derivation (the former C8 cross-face rule is gone). A line layer's
 *  border paints by its own value config; a polygon/point layer's border is
 *  only the outline and never classifies by value (two states only). */
const effectiveBorderValue = (ui: LayerUI, layerId: string): ValueConfig | undefined =>
  getIntent(ui, layerId, INTENT.BORDER_VALUE);

/** The mode the border row shows and the stroke paints.
 *
 *  mode or (value ? value : solid) — the shared stroke resolver. A stored
 *  mode always wins; a mode-less border defers to whether an own value
 *  exists. No fill-side fallback: the border never inherits the fill's
 *  config. */
const effectiveBorderMode = (ui: LayerUI, layerId: string): FillMode =>
  resolveStrokeMode(
    getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE),
    effectiveBorderValue(ui, layerId),
  );

/** Whether a value config is actually in force on the border face. The value
 *  mode is active exactly when the mode is value and a value exists; anything
 *  else paints the solid path. */
const borderValueActive = (ui: LayerUI, layerId: string): boolean =>
  effectiveBorderMode(ui, layerId) === FILL_MODE.VALUE &&
  effectiveBorderValue(ui, layerId) !== undefined;

/** The seed field for a first user border classification: the fill's own
 *  seed column when it is a numeric field of this layer, else the first
 *  numeric field. The author's scale column is the most likely to be kept. */
const borderSeedField = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
): string => {
  const column = ui.c.layerRegistry.get(layerId)?.fillAuthor?.scale?.column;
  return column !== undefined && fields.includes(column) ? column : fields[0];
};

/** The config the border value detail displays and writes from. The chain
 *  mirrors fill's valueForUi: the stored border value, then a seeded default.
 *  No fill-side derivation — the border owns its value independently. A
 *  stored field the current data no longer offers is resolved through the
 *  shared resolveField rule — the same rule the paint side uses, so the row
 *  and the map cannot disagree. */
const borderValueForUi = (
  ui: LayerUI,
  layerId: string,
  fields: readonly string[],
): ValueConfig => {
  const stored = resolvedValue(
    ui,
    layerId,
    getIntent(ui, layerId, INTENT.BORDER_VALUE),
  );
  if (stored) return stored;
  const field = borderSeedField(ui, layerId, fields);
  const layer = (ui.c.layerRegistry.get(layerId)?.layer ??
    ui.c.findLayer(layerId)) as L.Layer | null;
  const kind = layer ? inferFieldKind(layer, field) : "numeric";
  return kind === VALUE_KIND.CATEGORY
    ? {
        kind: VALUE_KIND.CATEGORY,
        field,
        method: CONST.FILL_VALUE.METHOD_DEFAULT,
        classes: CLASS_COUNT.DEFAULT,
        scheme: CONST.FILL_VALUE.CATEGORY_SCHEME_DEFAULT,
      }
    : {
        kind: VALUE_KIND.NUMERIC,
        field,
        method: CONST.FILL_VALUE.METHOD_DEFAULT,
        classes: CLASS_COUNT.DEFAULT,
        scheme: CONST.FILL_VALUE.SCHEME_DEFAULT,
      };
};

/** Persist a border value config in the shape the validator accepts. Mirrors
 *  fill's persistedValue: clamps the numeric class count into the editable
 *  vocabulary, keeps a category record's optional method/classes as-is. */
const persistedBorderValue = (value: ValueConfig): ValueConfig =>
  value.kind === VALUE_KIND.CATEGORY
    ? {
        kind: VALUE_KIND.CATEGORY,
        field: value.field,
        method: value.method,
        classes: value.classes,
        scheme: value.scheme,
      }
    : {
        kind: VALUE_KIND.NUMERIC,
        field: value.field,
        method: value.method,
        classes: Math.min(CLASS_COUNT.MAX, Math.max(CLASS_COUNT.MIN, value.classes)),
        scheme: value.scheme,
      };

/** Write the border mode intent, seeding the border value when the user
 *  switches to the by-value mode and none is stored yet. */
const writeBorderMode = (ui: LayerUI, layerId: string, mode: FillMode): boolean => {
  if (mode === FILL_MODE.VALUE) {
    if (!hasValueField(ui, layerId)) return false;
    const fields = valueFields(ui, layerId);
    getDimension(DIM.BORDER)!.write!(ui, layerId, {
      mode,
      value: persistedBorderValue(borderValueForUi(ui, layerId, fields)),
    });
    return true;
  }
  getDimension(DIM.BORDER)!.write!(ui, layerId, { mode });
  return true;
};

/** Merge one border value-detail change into the stored config and schedule
 *  the per-leaf repaint through the dimension write. */
const writeBorderValue = (
  ui: LayerUI,
  layerId: string,
  patch: Partial<ValueConfig>,
): ValueConfig => {
  const fields = valueFields(ui, layerId);
  const merged: ValueConfig = {
    ...borderValueForUi(ui, layerId, fields),
    ...patch,
  };
  if (patch.field !== undefined) {
    const layer = (ui.c.layerRegistry.get(layerId)?.layer ??
      ui.c.findLayer(layerId)) as L.Layer | null;
    const inferred = layer ? inferFieldKind(layer, patch.field) : "numeric";
    if (inferred === VALUE_KIND.CATEGORY) {
      merged.kind = VALUE_KIND.CATEGORY;
      if (!(merged.scheme in CATEGORY_SCHEMES)) {
        merged.scheme = CONST.FILL_VALUE.CATEGORY_SCHEME_DEFAULT;
      }
    } else {
      merged.kind = VALUE_KIND.NUMERIC;
      if (!(DEFAULT_SCHEMES as readonly string[]).includes(merged.scheme)) {
        merged.scheme = CONST.FILL_VALUE.SCHEME_DEFAULT;
      }
    }
  }
  const next: ValueConfig = persistedBorderValue(merged);
  getDimension(DIM.BORDER)!.write!(ui, layerId, {
    mode: FILL_MODE.VALUE,
    value: next,
  });
  return next;
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
const derivedFillColor = (node: StyleSetter): string | undefined => {
  // The leaf's live fill paint is the single source: Leaflet paths carry the
  // author's fillColor from creation and every subsequent setStyle write
  // (solid, value-classified, original per-feature) lands there too, so one
  // read covers all three fill states. Fall back to folium's per-feature
  // property (geopandas explore output) and then to the author's stroke, the
  // same chain the fill author snapshot uses.
  const fill = node.options?.fillColor;
  if (fill !== undefined) return fill;
  const props = (
    node as StyleSetter & { feature?: { properties?: Record<string, unknown> } }
  ).feature?.properties;
  const propColor = props?.__folium_color;
  if (typeof propColor === "string") return propColor;
  return node.options?.color;
};

const applyBorderToLayer = (ui: LayerUI, layerId: string): void => {
  // Register this UI's stroke replay once (idempotent): a follow-fill border
  // re-derives from the leaf's current fill, and the fill writer asks for
  // this replay by face — no direct fill → border import, no cycle.
  registerFaceReplay(ui, FACE.STROKE, id => applyBorderToLayer(ui, id));
  // Value mode: when the derived border mode is 'value' and a value exists,
  // delegate the whole face to the stroke engine. The engine owns the
  // per-leaf classification, the merged author+value write, and the
  // highlight pin — this function only derives the live config so the
  // pin's getter and a later fill-only repaint agree with this paint.
  const value = effectiveBorderValue(ui, layerId);
  if (borderValueActive(ui, layerId)) {
    applyValueStroke(
      ui,
      layerId,
      resolvedValue(ui, layerId, value)!,
      stored => resolvedValue(ui, layerId, stored)!,
      () => effectiveBorderValue(ui, layerId),
      () => effectiveBorderMode(ui, layerId),
      getIntent(ui, layerId, INTENT.BORDER_WEIGHT),
    );
    return;
  }
  // Solid path (unchanged): a flat color+weight write per leaf.
  // ORIGINAL owns no user colour: the author's per-leaf stroke is the target,
  // so the colour override is treated as absent and the walk below restores
  // each leaf's captured author face (mirror of fill's original mode). It stays
  // in the intent record, so a later switch back to solid still restores it.
  const mode = effectiveBorderMode(ui, layerId);
  const original = mode === FILL_MODE.ORIGINAL;
  const solid = mode === FILL_MODE.SOLID;
  // FOLLOW_FILL paints the border with the fill's current colour (single mode
  // only - displayBorderMode falls back otherwise). Never a copy: the intent
  // stays absent, so a fill edit recomputes the border through contentChange.
  const followFill = mode === FILL_MODE.FOLLOW_FILL;
  // SOLID owns exactly one colour (mirror of fill's deriveSolidBase). When no
  // BORDER_COLOR intent exists the base is the layer's authored stroke — NOT
  // each leaf's captured author bag, which for a per-feature layer holds a
  // different colour per leaf (restoring it is the original mode's job, not
  // solid's). The base is the same reader the solid row's swatch uses
  // (buildSolidBorderDetail -> authoredBorder -> styleBaseOf), so the panel
  // and the map cannot disagree. Only a per-feature layer needs the
  // derivation: a uniform layer's author stroke is already one colour, and a
  // colour basemap is excluded by the layerCanBorder capability gate.
  const deriveSolidBase = solid && paintsPerFeatureFill(ui, layerId);
  const solidColor = deriveSolidBase
    ? (getIntent(ui, layerId, INTENT.BORDER_COLOR) ?? styleBaseOf(ui, layerId).color)
    : getIntent(ui, layerId, INTENT.BORDER_COLOR);
  const color = original
    ? undefined
    : followFill
      ? undefined // per-leaf derived below (no single intent to read)
      : solidColor;
  const weight = getIntent(ui, layerId, INTENT.BORDER_WEIGHT);
  const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
  if (!layer) return;
  // Follow-fill always owns an override even though no colour intent is
  // stored: the per-leaf derived write IS the user's border. Without this
  // the guard below would skip an untouched leaf and leave it at the author's
  // stroke.
  const hasOverride = color !== undefined || weight !== undefined || followFill;
  const values: Record<string, unknown> = {};
  if (color !== undefined) values.color = color;
  if (weight !== undefined) values.weight = weight;
  // Groups are descended, never written: walkStyleLeaves filters to leaves
  // that own setStyle, so a group's style function (L.GeoJSON, L.FeatureGroup)
  // never captures the base in place of its features.
  walkStyleLeaves(layer, node => {
    // A leaf that was never written and has nothing to own is left alone: no
    // restore, no pin. An uncommitted layer keeps folium's own hover handling
    // and gains no per-leaf cost (same guard as fill's apply).
    if (!hasOverride && styleBagOf(node) === undefined) return;
    if (!hasOverride) {
      // No override left: restore the author's face rather than skipping the
      // walk, or the previous mode's colour stays on the map until folium's
      // next mouseout happens to overwrite it.
      restoreStyleDim(node, FACE.STROKE);
    } else if (original && values.color === undefined) {
      // ORIGINAL mode owns no user colour (color is `undefined`), so the only
      // override here is a weight. A minimal commit would write just the
      // weight and leave the previous mode's colour painted on the leaf: the
      // solid colour would ride under the author's stroke until some later
      // hover happened to overwrite it. Pull the author's stroke keys back in
      // the same payload and light the face bit, mirroring fill's opacity-only
      // arm — one setStyle per leaf, and the colour reverts to the author's.
      commitStyleDimMerged(node, values, FACE.STROKE, true);
    } else if (followFill) {
      // Follow-fill is a per-leaf derived paint: the border takes this leaf's
      // CURRENT fill colour — the solid colour, the classified colour a value
      // fill painted, or the author's per-feature colour — never a copy into
      // the border intent. The derivation reads the leaf's live `options` so a
      // fill edit on the same face re-derives on the next border flush.
      commitStyleDim(node, { color: derivedFillColor(node), weight }, FACE.STROKE);
    } else {
      // Shared write contract: value keys + visibility bit (stroke: true).
      commitStyleDim(node, values, FACE.STROKE);
    }
    // Pin the leaf's stroke against folium's highlight restore via the shared
    // pinStyleOnHighlight hook, keyed 'border' so a re-commit
    // replaces this dimension's getter instead of stacking another closure.
    // The fill row pins under its own key on the same leaf: one shared
    // mouseout handler merges both dimensions into a single setStyle, so a
    // highlight-restore can neither drop one dimension nor grow a getter
    // list with every commit.
    pinStyleOnHighlight(node, DIM.BORDER, () => {
      // The author's own stroke is the paint in ORIGINAL: folium's mouseout
      // restore already put it back, so there is no user face to replay.
      if (effectiveBorderMode(ui, layerId) === FILL_MODE.ORIGINAL) return null;
      const w = getIntent(ui, layerId, INTENT.BORDER_WEIGHT);
      // Follow-fill replays this leaf's CURRENT derived colour, so a fill
      // change followed by a highlight restore keeps the border in step.
      // For solid, replay the derived base only when the user owns the paint:
      // a solid mode with NO intent at all (an uncommitted per-feature layer)
      // has folium's own author restore on mouseout — replaying the base
      // would stamp the first leaf's colour over every leaf (mirror of fill).
      const ownIntent =
        getIntent(ui, layerId, INTENT.BORDER_COLOR) !== undefined ||
        getIntent(ui, layerId, INTENT.BORDER_WEIGHT) !== undefined ||
        getIntent(ui, layerId, INTENT.BORDER_VALUE) !== undefined ||
        getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE) !== undefined;
      const c = followFill
        ? derivedFillColor(node)
        : ownIntent
          ? solidColor
          : undefined;
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
  scheduleStyleDimApply(FACE.STROKE, layerId, () => applyBorderToLayer(ui, layerId), {
    owner: ui,
  });
};

/** Write the color into the map, persist it, and mark the dimension as
 *  user-owned so it survives a reload. Only writes when the value actually
 *  moved — a color-picker drag revisits every step, and each pass is a
 *  sweep over every feature of the layer.
 *
 *  Called from `bindLiveColor`, so `rawColor` is a raw `input.value` and is
 *  normalized to 6-digit lowercase hex before landing in storage. */
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
 *  entry. "Authored" means the base captured on first write — `setStyle`
 *  mutates `options` in place, so the captured value is the only source of
 *  truth for the author's stroke by reset time.
 *
 *  Both sub-dimensions are restored from the captured base, and the
 *  persisted overrides are removed either way so the next load does not
 *  re-apply a stroke the layer no longer shows. */
const resetLayerBorder = (ui: LayerUI, layerId: string): void => {
  if (!ui.c.layerRegistry.has(layerId)) return;
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
    const input = colorInput({
      value: target.color,
      className: target.className,
      ariaLabel: target.colorAria,
    }) as HTMLInputElement;
    if (target.colorReadOnly) {
      // The swatch keeps its swatch/hex chrome; only editability differs. Both
      // readOnly and disabled so no picker opens and no keyboard edit lands.
      // READONLY is the shared no-edit class the unified hover rule in
      // common/input.css excludes — the same channel the fill original mode's
      // read-only box uses, so a disabled border swatch carries no hover or
      // focus hint.
      input.readOnly = true;
      input.disabled = true;
      input.tabIndex = -1;
      input.classList.add(PANEL_CLASS.READONLY);
    }
    parts.push(input);
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
    dom.el("label", { class: PANEL_CLASS.FORM_LABEL }, target.label),
    dom.el("div", { class: PANEL_CLASS.FORM_CONTROL }, inlineControls(...parts)),
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

/** The width-only border row shared by the modes that own no user colour.
 *  FOLLOW_FILL paints a derived per-leaf fill colour and a per-feature
 *  ORIGINAL author has no single colour value, so neither can offer a
 *  swatch: the row owns the width control only, sitting in the right column
 *  (the shared `.foliplus-style-size-row` inline right-align). The caller
 *  resolves the author's stroke for the initial width. */
const buildBorderWidthOnlyRow = (
  ui: LayerUI,
  layerId: string,
  author: { weight: number },
): HTMLElement => {
  const weight = getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight;
  return buildBorderRowShell({
    rowClass: `${PANEL_CLASS.FORM_ROW} ${CONST.CLASSES.STYLE_BORDER_ROW} foliplus-style-size-row`,
    label: ui.T("border"),
    color: "",
    weight,
    hasColorInput: false,
    hasWeightInput: true,
    className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
    weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
    colorAria: ui.T("style_border_color"),
    weightAria: ui.T("style_border_weight"),
  });
};
/** The solid mode's border detail: color swatch + width number, one row.
 *  Mirrors fill's solid detail but keeps the border's own row class and
 *  the width control (the fill side has no width). */
const buildSolidBorderDetail = (ui: LayerUI, layerId: string): HTMLElement[] => {
  const author = authoredBorder(ui, layerId);
  const mode = displayBorderMode(ui, layerId);
  // In ORIGINAL mode the border colour is the author's own stroke — it is not
  // the user's to change, so the colour input renders disabled (the same
  // colorInput control the single-color mode uses). Weight stays editable.
  // FOLLOW_FILL paints a derived per-leaf colour: there is no single
  // colour the user could pick (a value fill classifies per leaf, an
  // original fill is the author's own), so the row owns a width control
  // only — no colour swatch at all. The width stays in the right column
  // (the shared `.foliplus-style-size-row` inline right-align).
  if (mode === FILL_MODE.FOLLOW_FILL) {
    return [buildBorderWidthOnlyRow(ui, layerId, author)];
  }

  if (mode === FILL_MODE.ORIGINAL) {
    // ORIGINAL owns no user color: the row must show the author's own stroke,
    // never the color the user set in the single-color mode (that intent stays
    // stored and takes effect only when the mode returns to solid). Reading
    // INTENT.BORDER_COLOR here would show the user's color after a solid ->
    // original round-trip — the reported bug. Same source as the leaf restore
    // path (restoreStyleDim / author face).
    // A per-feature author has no single colour value: a swatch would lie, so
    // the shared read-only original detail (the same rows the fill original
    // mode shows) replaces the colour input; only the width stays editable in
    // the right column (the shared .foliplus-style-size-row inline right-align).
    // A single-colour author keeps the real swatch (inert) — pixel-identical
    // to SINGLE, only its editability differs.
    if (paintsPerFeatureFill(ui, layerId)) {
      return [
        ...buildOriginalDetail(ui, layerId),
        buildBorderWidthOnlyRow(ui, layerId, author),
      ];
    }
    const color = displayColor(author.color);
    const weight = getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight;
    // Same colour control as the single-color mode (buildBorderRowShell ->
    // colorInput), only inert: the author's stroke is not the user's to change.
    // Reusing the real input keeps the ORIGINAL row pixel-identical to SINGLE
    // (swatch + hex + weight) rather than degrading to a bare read-only box.
    return [
      buildBorderRowShell({
        rowClass: `${PANEL_CLASS.FORM_ROW} ${CONST.CLASSES.STYLE_BORDER_ROW}`,
        label: ui.T("border"),
        color,
        weight,
        hasColorInput: true,
        hasWeightInput: true,
        className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
        weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
        colorAria: ui.T("style_border_color"),
        weightAria: ui.T("style_border_weight"),
        colorReadOnly: true,
      }),
    ];
  }
  return [
    buildBorderRowShell({
      rowClass: `${PANEL_CLASS.FORM_ROW} ${CONST.CLASSES.STYLE_BORDER_ROW}`,
      label: ui.T("border"),
      color: displayColor(getIntent(ui, layerId, INTENT.BORDER_COLOR) ?? author.color),
      weight: getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight,
      hasColorInput: true,
      hasWeightInput: true,
      className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
      weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
      colorAria: ui.T("style_border_color"),
      weightAria: ui.T("style_border_weight"),
    }),
  ];
};

/** Destroy the panel's border scheme picker, if any. Idempotent; also
 *  called when a mode switch rebuilds the value detail so a stale picker
 *  cannot answer the next click. Mirrors fill's disposeFillRow. */
const disposeBorderRow = (ui: LayerUI): void => {
  borderSchemeOverlayByUi.get(ui)?.();
  borderSchemeOverlayByUi.delete(ui);
  borderSchemePickerByUi.get(ui)?.destroy();
  borderSchemePickerByUi.delete(ui);
};

/** The border mode the row's select shows. The default is "original"
 *  (the author's own stroke). A stored "by_value" on a polygon/point layer —
 *  where the border is only the outline and never classifies by value — reads
 *  as the illegal value and falls back to "original"; no compatibility
 *  migration is performed. */
const displayBorderMode = (ui: LayerUI, layerId: string): FillMode => {
  const stored = getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE);
  // Same pre-mode record shape the fill side reads: a stored colour without a
  // mode means the user already painted the solid mode (the record written
  // before this mode existed, and a programmatic colour write). An absent
  // mode plus only a weight keeps the author's stroke — the weight rides both
  // modes and does not move the mode, same rule as the fill's opacity.
  if (stored === undefined) {
    if (getIntent(ui, layerId, INTENT.BORDER_COLOR) !== undefined) {
      return FILL_MODE.SOLID;
    }
    return FILL_MODE.ORIGINAL;
  }
  if (stored === FILL_MODE.VALUE && !borderCarriesValue(ui, layerId)) {
    return FILL_MODE.ORIGINAL;
  }
  // FOLLOW_FILL is a per-leaf derived paint: it holds across every fill
  // state (solid / by-value / original), because the border follows each
  // leaf's CURRENT fill colour — the single fill colour, the classified
  // colour the leaf actually paints, or the author's per-feature colour.
  // The stored mode always wins; no fallback narrows it to solid.
  return stored;
};

/** Whether the border face can paint by value: the border is the element's
 *  own primary colour only on a line. Polygon/point borders are the outline
 *  and never classify by value (two states only: original + single). */
const borderCarriesValue = (ui: LayerUI, layerId: string): boolean =>
  geometryKindOf(ui, layerId) === GEOM_TYPE.LINE;

/** The geometry category of a border-capable layer, resolved from the
 *  surface (never a layer-name/type-string guess). */
const geometryKindOf = (ui: LayerUI, layerId: string): string | null => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return null;
  return ui.c.surfaceFor(layerInfo).geometryType();
};

/** Render the detail slot for the active border mode into the block's
 *  detail element. Called on open and after every mode switch. */
/** The detail mode the border block renders for the current display mode:
 *  'original' and 'solid' both show the solid controls; only an explicit
 *  'value' choice shows the value controls. */
const borderDetailMode = (ui: LayerUI, layerId: string): FillMode => {
  const display = displayBorderMode(ui, layerId);
  if (display === FILL_MODE.VALUE) return FILL_MODE.VALUE;
  // FOLLOW_FILL renders its own width-only row (no colour input): the
  // derived colour is not the user's to edit, but the width stays editable.
  if (display === FILL_MODE.FOLLOW_FILL) return FILL_MODE.FOLLOW_FILL;
  return FILL_MODE.SOLID;
};

const renderBorderDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: FillMode,
): void => {
  disposeBorderRow(ui);
  detail.replaceChildren();
  if (mode === FILL_MODE.VALUE && hasValueField(ui, layerId)) {
    const fields = valueFields(ui, layerId);
    const value = borderValueForUi(ui, layerId, fields);
    for (const row of buildValueDetail(ui, layerId, fields, value)) {
      detail.append(row);
    }
    // The width stays editable in every border mode: the by-value detail
    // shares the fill's field/method/scheme rows and appends the border's own
    // width-only row (the same shell follow-fill and per-feature original
    // use) — one width channel, no per-mode DOM shape.
    detail.append(buildBorderWidthOnlyRow(ui, layerId, authoredBorder(ui, layerId)));
  } else {
    detail.append(...buildSolidBorderDetail(ui, layerId));
  }
};

/** Build the border row block: the mode select (three states for a line,
 *  two for polygon/point) plus the active mode's detail slot. A layer with no
 *  numeric field has no mode select and only owns the solid controls.
 *
 *  The three-state vocabulary applies only where the border IS the element's
 *  primary colour (a line). A polygon/point border is the outline and offers
 *  only original + single; the by_value mode would duplicate the fill's own
 *  value config on the same face. */
const buildBorderRow = (ui: LayerUI, layerId: string): HTMLElement => {
  const block = dom.el("div", {
    class: CONST.CLASSES.STYLE_BORDER_BLOCK,
    "data-style-dim": "border",
  });
  if (!hasValueField(ui, layerId)) {
    block.append(...buildSolidBorderDetail(ui, layerId));
    return block;
  }
  const carriesValue = borderCarriesValue(ui, layerId);
  // FOLLOW_FILL is offered only where the border is an outline over a filled
  // face (polygon/point). A line's border IS its primary colour - there is no
  // fill to follow, so a fourth option would be a permanently-falling-back
  // dead entry on a line.
  const canFollowFill = !carriesValue;
  const options = [
    { value: FILL_MODE.ORIGINAL, label: ui.T(STYLE_MODE.ORIGINAL) },
    { value: FILL_MODE.SOLID, label: ui.T(STYLE_MODE.SINGLE) },
    ...(canFollowFill
      ? [{ value: FILL_MODE.FOLLOW_FILL, label: ui.T("style_border_follow_fill") }]
      : []),
    ...(carriesValue
      ? [{ value: FILL_MODE.VALUE, label: ui.T(STYLE_MODE.BY_VALUE) }]
      : []),
  ];
  const modeRow = buildModeRow({
    label: ui.T("style_border_mode"),
    selectClass: CONST.CLASSES.STYLE_BORDER_MODE_SELECT,
    rowClass: CONST.CLASSES.STYLE_BORDER_ROW,
    detailClass: CONST.CLASSES.STYLE_BORDER_DETAIL,
    value: displayBorderMode(ui, layerId),
    options,
    surface: dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });
  block.append(modeRow.block, modeRow.detail);
  renderBorderDetail(ui, layerId, modeRow.detail, borderDetailMode(ui, layerId));
  return block;
};

/** Drop the out-of-vocabulary class option once the user picks a 2..9 count;
 *  mirrors fill's convergeClassesRow. */
const convergeBorderClassesRow = (select: HTMLSelectElement, classes: number): void => {
  const extra = Array.from(select.options).find(
    option => !CLASS_COUNT_VALUES.includes(Number(option.value)),
  );
  if (!extra) return;
  extra.remove();
  select.value = String(classes);
  const dropdown = dropdownOf(select);
  dropdown?.setHint("");
  dropdown?.refresh();
};

/** Bind the value detail's three controls (field / method+classes / scheme)
 *  plus the scheme picker. Mirrors fill's bindValueDetail but writes through
 *  the border dimension and registers the border picker overlay id. */
const bindBorderValueDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
): void => {
  const trigger = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_TRIGGER}`,
  ) as HTMLElement;
  const hidden = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_SCHEME_HIDDEN}`,
  ) as HTMLSelectElement;
  const fields = valueFields(ui, layerId);
  const value = borderValueForUi(ui, layerId, fields);
  const picker = createSchemePicker({
    trigger,
    hiddenSelect: hidden,
    schemes: valueSchemes(value),
    value: valueSchemeForUi(value),
    colorScale: getColorScale,
    numClasses: value.classes,
    portal: true,
    resolveHost: () => fullscreenSurface(ui.c.map.getContainer()),
    onSurfaceChange: onFullscreenSurfaceChange,
    label: ui.T("style_fill_scheme"),
    onChange: name => writeBorderValue(ui, layerId, { scheme: name }),
  });
  borderSchemePickerByUi.set(ui, picker);
  borderSchemeOverlayByUi.set(
    ui,
    ensureOverlayRegistry(ui.c.map).register({
      id: OVERLAY_IDS.BORDER_PICKER_DROPDOWN,
      isOpen: () => picker.getDropdown() !== null,
      panels: () => [trigger],
      close: ({ restoreFocus }) => picker.close({ restoreFocus }),
      dismissOn: "click",
      pressPriority: 845,
    }),
  );

  const fieldSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_FIELD_SELECT}`,
  ) as HTMLSelectElement;
  fieldSelect.onchange = () =>
    writeBorderValue(ui, layerId, { field: fieldSelect.value });

  const methodSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_METHOD_SELECT}`,
  ) as HTMLSelectElement | null;
  if (methodSelect !== null) {
    methodSelect.onchange = () =>
      writeBorderValue(ui, layerId, {
        method: methodSelect.value as ValueConfig["method"],
      });
  }

  const classesSelect = detail.querySelector(
    `.${CONST.CLASSES.STYLE_FILL_CLASSES_SELECT}`,
  ) as HTMLSelectElement | null;
  if (classesSelect !== null) {
    classesSelect.onchange = () => {
      const next = writeBorderValue(ui, layerId, {
        classes: parseInt(classesSelect.value, 10),
      });
      picker.setNumClasses(next.classes);
      convergeBorderClassesRow(classesSelect, next.classes);
    };
  }
};

/** Bind one detail slot for the active border mode. Called on open and after
 *  every mode switch. */
const bindBorderDetail = (
  ui: LayerUI,
  layerId: string,
  detail: HTMLElement,
  mode: FillMode,
): void => {
  if (mode === FILL_MODE.VALUE && hasValueField(ui, layerId)) {
    bindBorderValueDetail(ui, layerId, detail);
    // Bind the width-only row appended to the value detail: the same shell
    // binder the other modes use, so the weight commits through one channel.
    bindBorderRowShell(detail, {
      className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
      weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
      onChangeWeight: value => commitBorderWeight(ui, layerId, value),
      onFlush: () => flushStyleDimApply(FACE.STROKE, layerId, ui),
    });
  } else {
    bindBorderRowShell(detail, {
      className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
      weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
      onChangeColor: value => commitBorderColor(ui, layerId, value),
      onChangeWeight: value => commitBorderWeight(ui, layerId, value),
      onFlush: () => flushStyleDimApply(FACE.STROKE, layerId, ui),
    });
  }
};

/** Wire the border block: the mode select switches modes in place (rebuilding
 *  the detail slot), and the active mode's controls commit through the
 *  dimension's write path. A layer with no numeric field has no mode select
 *  and only owns the solid controls. */
const bindBorderRow = (ui: LayerUI, layerId: string, row: HTMLElement): void => {
  const block = (row.closest("[data-style-dim='border']") ??
    row.closest(`.${CONST.CLASSES.STYLE_BORDER_BLOCK}`)) as HTMLElement | null;
  if (!block) {
    bindBorderRowShell(row, {
      className: CONST.CLASSES.STYLE_BORDER_COLOR_INPUT,
      weightClassName: CONST.CLASSES.STYLE_BORDER_WEIGHT_INPUT,
      onChangeColor: value => commitBorderColor(ui, layerId, value),
      onChangeWeight: value => commitBorderWeight(ui, layerId, value),
      onFlush: () => flushStyleDimApply(FACE.STROKE, layerId, ui),
    });
    return;
  }
  const select = block.querySelector(
    `.${CONST.CLASSES.STYLE_BORDER_MODE_SELECT}`,
  ) as HTMLSelectElement | null;
  if (!select) {
    bindBorderDetail(ui, layerId, block, effectiveBorderMode(ui, layerId));
    return;
  }
  const detail = block.querySelector(
    `.${CONST.CLASSES.STYLE_BORDER_DETAIL}`,
  ) as HTMLElement | null;
  select.onchange = () => {
    // Compare against the DISPLAY mode (what the select shows), so a
    // polygon/point layer whose stored mode reads as original again does not
    // re-write the same mode.
    const previous = displayBorderMode(ui, layerId);
    const raw = select.value;
    const next = raw as FillMode;
    if (next === previous) return;
    if (!writeBorderMode(ui, layerId, next)) return;

    if (detail) {
      renderBorderDetail(ui, layerId, detail, borderDetailMode(ui, layerId));
      bindBorderDetail(ui, layerId, detail, borderDetailMode(ui, layerId));
    }
  };
  if (detail) bindBorderDetail(ui, layerId, detail, borderDetailMode(ui, layerId));
};
/** Register border as a per-layer dimension. The descriptor wires the existing
 *  helpers plus the intent+persist slots: `write` / `reset` own store +
 *  styleBag orchestration (cohesive `LayerIntentStore.set` / `.clear`); the named
 *  `commitBorderColor` / `commitBorderWeight` / `resetLayerBorder` stay as
 *  thin delegates so panel call sites and tests keep their shape.
 *
 *  Registered ahead of `opacity` and `zoomRange` in `DIM_ORDER`
 *  (see `./registry.js`): border comes second in the label panel's
 *  Layer section, right after fill. */
const BORDER_DIMENSION = registerDimension<{
  color: string;
  weight: number;
  mode: FillMode;
  value?: ValueConfig;
}>({
  key: DIM.BORDER,
  gate: layerCanBorder,
  value: (ui, layerId) => {
    const layerInfo = ui.c.layerRegistry.get(layerId);
    if (!layerInfo) return undefined;
    const author = authoredBorder(ui, layerId);
    const value = effectiveBorderValue(ui, layerId);
    return {
      color: getIntent(ui, layerId, INTENT.BORDER_COLOR) ?? author.color,
      weight: getIntent(ui, layerId, INTENT.BORDER_WEIGHT) ?? author.weight,
      mode: effectiveBorderMode(ui, layerId),
      value: value === undefined ? undefined : resolvedValue(ui, layerId, value),
    };
  },
  row: buildBorderRow,
  /** Intent+persist + schedule the stroke face landing. `patch` is already
   *  normalized. Omitted keys leave that sub-dimension alone. */
  write: (ui, layerId, patch) => {
    const { color, weight, mode, value } = patch;
    const writes: Array<readonly [IntentKey, unknown]> = [];
    if (color !== undefined) writes.push([INTENT.BORDER_COLOR, color]);
    if (weight !== undefined) writes.push([INTENT.BORDER_WEIGHT, weight]);
    if (value !== undefined) writes.push([INTENT.BORDER_VALUE, value]);
    // 'mode' present writes the explicit mode; an omitted mode leaves the
    // stored border mode alone (no cross-face derivation exists any more).
    if (mode !== undefined) writes.push([INTENT.BORDER_STYLE_MODE, mode]);
    if (!writeIntentKeys(ui, layerId, writes)) return;
    scheduleBorderApply(ui, layerId);
  },
  /** Cohesive reset: cancel trailing apply, clear all border overrides
   *  (color/weight/mode/value), save, restore the author's stroke face from
   *  the style bag. */
  reset: (ui, layerId) => {
    cancelStyleDimApply(FACE.STROKE, layerId, ui);
    resetIntentKeys(ui, layerId, BORDER_INTENT_KEYS);
    const layer = ui.c.findLayer(layerId) as StyleCarrier | null;
    if (!layer) return;
    // Same restore walk as fill — one styleBag contract, not two copies.
    walkStyleLeaves(layer, node => restoreStyleDim(node, FACE.STROKE));
  },
  valueSource: (ui, layerId) => {
    if (!layerCanBorder(ui, layerId)) return "none";
    if (
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_COLOR) ||
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_WEIGHT) ||
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_VALUE) ||
      ui.intentStore.isUserSet(layerId, INTENT.BORDER_STYLE_MODE)
    ) {
      return "user";
    }
    return "author";
  },
  /** Content-change replay: a stroke chosen before a leaf landed reaches it
   *  through the same coalesced walk an edit takes. The when-gate mirrors
   *  applyBorderToLayer's own bail, before any scheduler box is allocated. */
  contentChange: {
    kind: "frame",
    face: FACE.STROKE,
    when: (ui, layerId) =>
      getIntent(ui, layerId, INTENT.BORDER_COLOR) !== undefined ||
      getIntent(ui, layerId, INTENT.BORDER_WEIGHT) !== undefined ||
      getIntent(ui, layerId, INTENT.BORDER_VALUE) !== undefined ||
      getIntent(ui, layerId, INTENT.BORDER_STYLE_MODE) !== undefined ||
      effectiveBorderValue(ui, layerId) !== undefined,
    run: (ui, layerId) => applyBorderToLayer(ui, layerId),
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
  disposeBorderRow,
  layerCanBorder,
  resetLayerBorder,
};
