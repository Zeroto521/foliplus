// core — per-layer user intent: types + vocabulary (the intent domain).
//
// Sunk from LayerControl: intent is a base-layer concept — third-party
// layers carry user intent too, so the row store and its types live beside the
// registry instead of inside the control. Moved verbatim from
// `LayerControl/type.ts` (LayerOverride / LayerIntent / PersistedLayerState /
// IntentRow / LoadSource / LabelConfig) and `LayerControl/ui/intent.ts`
// (INTENT / LIVE / STYLE_KEYS / IntentKey) — semantics unchanged.
import { type ClassifyMethod, isClassifyMethod } from "#core/value/classify.js";
import type { NumberStyle } from "#foliplus/config-schema.js";

/** One mode of the value-based fill. Two shapes, discriminated by `kind`:
 *
 *  - **numeric** (`kind: "numeric"` or absent): the property is a number,
 *    split into ordered classes. `field` is the caller's key selection;
 *    `method` / `classes` / `scheme` are the classifier + palette inputs
 *    (core/ramp.ts).
 *  - **category** (`kind: "category"`): the property is a categorical label,
 *    painted with a discrete qualitative scheme. `scheme` is the category
 *    palette; `method` / `classes` are irrelevant to a category fill (a
 *    category is not ordered, so "classify" has no meaning) and are kept
 *    optional so a record that only ever carried them on the numeric mode can
 *    be reused unchanged.
 *
 *  A record that asks for a `kind` this client cannot build is dropped whole
 *  by the persistence reader rather than misapplied as a numeric ramp. */
type FillValueConfig =
  | {
      /** How the drive property is typed. Absent = "numeric". */
      kind?: "numeric";
      field: string;
      method: ClassifyMethod;
      classes: number;
      scheme: string;
    }
  | {
      /** The categorical mode: color by distinct label. */
      kind: "category";
      field: string;
      /** The qualitative scheme name (a `CATEGORY_SCHEMES` key). */
      scheme: string;
      /** Kept required at the type level so the union stays assignable to
       *  the numeric `RampConfig` and existing readers of `.method` /
       *  `.classes` compile unchanged. A category does not classify, so the
       *  values are unused at runtime; the validator still accepts them
       *  absent in a persisted record (they can be omitted there). */
      method: ClassifyMethod;
      classes: number;
    };

/** The stored fill-mode literals (persisted `fillMode`). One vocabulary for the
 *  row, the intent and the resolver.
 *
 *  "original" is the layer author's own per-feature paint: a real choice on a
 *  geopandas explore layer (it can be left and come back to), and an invalid
 *  one everywhere else — the row offers it only while the author's record still
 *  paints per feature, and a stored value on any other layer reads as solid. */
const FILL_MODE = {
  SOLID: "solid",
  VALUE: "value",
  ORIGINAL: "original",
} as const;
type FillMode = (typeof FILL_MODE)[keyof typeof FILL_MODE];

/** The marker-icon override's single kind. One constant so the write
 *  path, the persistence reader and the intent guard cannot drift on the
 *  literal. Mirrors FILL_MODE. */
const ICON_KIND = {
  GLYPH: "glyph",
} as const;
type IconKind = (typeof ICON_KIND)[keyof typeof ICON_KIND];

/** Whether a value is a ramp config this client can build. Two arms,
 *  discriminated by `kind`:
 *
 *  - **numeric** (absent or `"numeric"`): the four classifier fields
 *    (`field`, `method`, `classes`, `scheme`), each inside the bounds the
 *    picker offers.
 *  - **category** (`"category"`): `field` + a qualitative `scheme`, with
 *    `method` / `classes` optional and unused.
 *
 *  The persistence reader and the LIVE presence rule share this one
 *  predicate, so a live rule that accepted a partial config cannot let a
 *  caller set a record `buildRamp` / `buildCategoryRamp` cannot classify.
 *
 *  `field` and `scheme` are tested for non-whitespace only, never rewritten:
 *  a GeoJSON property called " score " is a different key from "score", so
 *  trimming on read would silently miss every feature after a reload. On the
 *  numeric mode `method` is different - it is a closed protocol token, so it
 *  goes through `isClassifyMethod` and a name outside the four (including
 *  one with padding or the wrong case) drops the record whole. On the
 *  category mode `kind` must be exactly "category"; a `method` / `classes`
 *  that are present are not re-validated (a migrated numeric record may carry
 *  them, and a category does not classify so they cannot be wrong in a way
 *  that affects the ramp). A `kind` outside the two drops the record whole
 *  rather than misapplying it as a numeric ramp. */
const isFillValueConfig = (value: unknown): value is FillValueConfig => {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  const isName = (v: unknown): v is string =>
    typeof v === "string" && v.trim().length > 0;
  if (data.kind === "category") {
    return (
      isName(data.field) &&
      isName(data.scheme) &&
      (data.method === undefined || isClassifyMethod(data.method)) &&
      (data.classes === undefined ||
        (typeof data.classes === "number" &&
          Number.isInteger(data.classes) &&
          data.classes >= 2 &&
          data.classes <= 9))
    );
  }
  if (data.kind !== undefined && data.kind !== "numeric") return false;
  return (
    isName(data.field) &&
    isClassifyMethod(data.method) &&
    isName(data.scheme) &&
    typeof data.classes === "number" &&
    Number.isInteger(data.classes) &&
    data.classes >= 2 &&
    data.classes <= 9
  );
};

/** Per-layer label config (matches what persistence stores). */
interface LabelConfig {
  show: boolean;
  field: string;
  /** Runtime paint overrides — fall back to the shared --foliplus-label-* tokens. */
  color: string;
  size: number;
  format: NumberStyle;
  /** Whether this layer's own labels thin themselves out where they overlap. */
  collide: boolean;
}

/** A dimension the user has actually set. `overrides` is the provenance half of
 *  the record: a dimension absent from it means the user never chose it, so the
 *  author's declared default stays in force. Only user actions add entries here,
 *  so a policy can never write through a user's choice -- which is what makes
 *  "the map overrides what I set" structurally impossible rather than a matter
 *  of remembering not to do it. */
type LayerOverride =
  | "visible"
  | "fillColor"
  | "fillOpacity"
  | "fillValue"
  | "fillMode"
  | "borderColor"
  | "borderWeight"
  | "borderValue"
  | "borderStyleMode"
  | "opacity"
  | "zoomRange"
  | "size"
  | "icon";

/** One layer's live intent values — the in-memory twin of
 *  {@link PersistedLayerState} (same value shapes) plus `name`.
 *
 *  Absent key = the user never chose that dimension (the author's declared
 *  default stays in force). Provenance is a separate axis
 *  (`IntentRow.provenance` / `LayerOverride`) and is deliberately not on this
 *  record. Disk shape is unchanged; the bridge is now
 *  `LayerIntentStore.toPersisted`, which returns the same `{ layers,
 *  renamedNames }` record this type describes.
 *
 *  **Adding a dimension** (e.g. label visibility or label position):
 *  1. A *user-settable* dim with an author default (like `visible`) gains a
 *     key here + the same literal in `LayerOverride`, `INTENT` / `LIVE`
 *     (`core/layer/intent.ts`) and `PARSE_OVERRIDE` (`persistence.ts`) — the
 *     `Record<…>` pins fail the build until every one of them exists, and
 *     the value rides `layers[id]` under that key. Disk-shape growth is a
 *     separate, explicit task.
 *  2. A *label-only* field (position, …) belongs on {@link LabelConfig}
 *     instead: it nests under `layers[id].label`, needs no provenance
 *     entry, and flows through the tolerant label parse untouched —
 *     only the field rule in `coerceAnnotationFields` (ui/style/label.ts)
 *     and the renderer consume it.
 *  3. How an *author default* is read depends on what consumes it:
 *     display-only → read live off the carrier (optionally cached per id);
 *     feeding an incremental write → freeze on first write (a re-read would
 *     feed the leaf its own last write — the slider compounds); no carrier
 *     to read → seed once at the delivery point, where a *fact* (Python's
 *     `data[].show`) beats an observation of map state. The readers
 *     today follow exactly this split — `styleBaseOf` (fill and border
 *     color/weight/opacity) live, `authorOpacityBase` / `authorZoomBounds`
 *     frozen, `authorVisible` seeded.
 *  4. A *snapshot* field — one derived at registration from the layer
 *     object (`layer` / `carrier` / `kind`) — is refreshed by a single
 *     rebuild point (rebuild the entry, then `upsert` in place), not by
 *     each consumer falling back independently. `registry.get` is the
 *     consumer-side default; a snapshot is only ever rewritten by its own
 *     resolution edge, so a late-arriving layer lands once and the
 *     consumer sees the rebuilt entry rather than N independent fallbacks. */
/** The marker-icon override: one glyph for every marker leaf in the layer.
 *  A single value (not a per-category mapping) — the icon dimension is a
 *  whole-layer choice, no field, no per-category assignment. The value is a
 *  glyph name accepted on syntax alone (any valid FA6 name; `PICKER_GLYPHS`
 *  in core/leaflet/glyphSource.ts is only the panel's shortcut grid, not a
 *  whitelist); `resolveGlyph` maps it to the FontAwesome class name, or null
 *  when the name is syntactically invalid (then the author icon stays). */
type IconIntent = {
  kind: IconKind;
  value: string;
};

const isIconIntent = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as { kind?: unknown }).kind === ICON_KIND.GLYPH &&
  typeof (value as { value?: unknown }).value === "string";

type LayerIntent = {
  /** Layer id → the user's visibility choice (true = shown). */
  visible?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  /** The value-based fill config when the layer is painted by a field.
   *  Kept when the active mode is solid — the mode switch back restores it. */
  fillValue?: FillValueConfig;
  /** Which fill mode the user chose: a single color, a value ramp, or the
   *  layer author's own per-feature colors. Absent means solid — the mode that
   *  predates the ramp. */
  fillMode?: FillMode;
  borderColor?: string;
  borderWeight?: number;
  /** The value-based stroke config when the layer border is painted by a
   *  field. Independent of fillValue: an explicit border ramp wins over the
   *  derived fill ramp. Kept when the active border arm is solid. */
  borderValue?: FillValueConfig;
  /** Which border arm the user chose: solid, or by value. Absent defers to
   *  the fill arm mode (the border follows the fill by default - one ramp
   *  selection covers both faces). */
  borderStyleMode?: FillMode;
  opacity?: number;
  zoomRange?: [number, number];
  /** The fixed pixel radius the user set (CircleMarker only). Frozen on
   *  first write like `authorOpacityBase` — a re-read would feed the leaf its
   *  own last write, compounding every keystroke. */
  size?: number;
  /** The marker-icon override: one glyph name for every marker leaf;
   *  absent = the author's icons stay. */
  icon?: IconIntent;
  /** User-assigned display name (replaces the layer's authored name). */
  name?: string;
  /** Label (label) config seed for this layer. Live label state after
   *  the seed applies still lives in LabelManager (`configEntries`). */
  label?: LabelConfig;
};

/** One layer's persisted intent: the values the user set, plus which dimensions
 *  they set them for. A value with no matching override is dropped on read. */
type PersistedLayerState = {
  visible?: boolean;
  /** The hex fill color the user picked in the style panel. LayerControl
   *  owns the write (a self-managed dimension — see ui/style/fill.ts), so
   *  it lives in this record rather than on the label config. */
  fillColor?: string;
  /** Fill opacity (0-1) the user set in the style panel. */
  fillOpacity?: number;
  /** The value-based fill config the user set (field / method / classes /
   *  scheme). The ramp mode owns the color; solid-mode opacity still rides
   *  along, so the two arms share one fillOpacity override. */
  fillValue?: FillValueConfig;
  /** Which fill mode is active ("solid" | "value" | "original"); the inactive
   *  config is kept rather than cleared so a switch back restores it. */
  fillMode?: FillMode;
  /** The hex stroke color the user picked in the style panel. LayerControl
   *  owns the write (a self-managed dimension — see ui/style/border.ts), so
   *  it lives in this record rather than on the label config. */
  borderColor?: string;
  /** The stroke width the user set, in the shared border bounds. */
  borderWeight?: number;
  /** The value-based stroke config the user set (field / method / classes /
   *  scheme). Independent of the fill config; absent defers to the fill
   *  ramp. The border value arm owns the stroke color; the width and stroke
   *  bit still ride the solid border write. */
  borderValue?: FillValueConfig;
  /** Which border arm is active ("solid" | "value"); the inactive config is
   *  kept so a switch back restores it. Absent defers to the fill arm. */
  borderStyleMode?: FillMode;
  opacity?: number;
  /** The handle positions the user moved, [minZoom, maxZoom]. The author's
   *  min_zoom / max_zoom is only the starting value, so it reaches this field
   *  only once the user has dragged the handles. */
  zoomRange?: [number, number];
  /** The fixed pixel radius the user set in the style panel (CircleMarker
   *  only). LayerControl owns the write — a self-managed dimension, see
   *  ui/style/size.ts. */
  size?: number;
  /** The marker-icon override the user set in the style panel (one glyph
   *  name for every marker leaf). LayerControl owns the write — a
   *  self-managed dimension, see ui/style/icon.ts. */
  icon?: IconIntent;
  /** The layer's label config — a style dimension of this layer,
   *  not an override: it carries no provenance marker and survives alongside
   *  an empty `overrides` array (a layer the user configured *only* labels
   *  for is still an entry here). */
  label?: LabelConfig;
  overrides: LayerOverride[];
};

/** One layer's live intent row — the LayerIntentStore carrier shape. Value axis
 *  plus provenance axis in one record, so a half-write cannot desync them
 *  through the store's cohesive `set` / `clear`. Absent intent key = the user
 *  never chose that dimension; provenance only ever holds {@link LayerOverride}
 *  keys (`name` / `label` are riders without markers). */
type IntentRow = {
  intent: LayerIntent;
  provenance: Set<LayerOverride>;
};

/** The intent half of a parsed persistence record — what
 *  `LayerIntentStore.loadFromPersisted` accepts. A subset of
 *  `PersistedRecord` (order / removed / foldedRoles stay outside the
 *  store); label config rides `layers[id].label`. */
type LoadSource = {
  renamedNames?: Record<string, string>;
  layers?: Record<string, PersistedLayerState>;
};

/** The intent-key vocabulary — the one place each dimension's key is spelled.
 *  The `satisfies` guard pins every value to an existing `LayerIntent` key, so
 *  adding a dimension means touching this table and the record type together. */
const INTENT = {
  VISIBLE: "visible",
  FILL_COLOR: "fillColor",
  FILL_OPACITY: "fillOpacity",
  FILL_VALUE: "fillValue",
  FILL_MODE: "fillMode",
  BORDER_COLOR: "borderColor",
  BORDER_WEIGHT: "borderWeight",
  BORDER_VALUE: "borderValue",
  BORDER_STYLE_MODE: "borderStyleMode",
  OPACITY: "opacity",
  ZOOM_RANGE: "zoomRange",
  SIZE: "size",
  ICON: "icon",
  NAME: "name",
  LABEL: "label",
} as const satisfies Record<string, keyof LayerIntent>;

type IntentKey = keyof LayerIntent;

/** Typed-presence rule per intent key — the one place the value vocabulary
 *  lives. An intent key's value is "live" when it has the type the record
 *  promises (0 / empty strings / empty arrays are real choices, not absence). */
const LIVE: Record<IntentKey, (value: unknown) => boolean> = {
  [INTENT.VISIBLE]: value => typeof value === "boolean",
  [INTENT.FILL_COLOR]: value => typeof value === "string",
  [INTENT.FILL_OPACITY]: value => typeof value === "number",
  [INTENT.FILL_VALUE]: isFillValueConfig,
  [INTENT.FILL_MODE]: value =>
    value === FILL_MODE.SOLID ||
    value === FILL_MODE.VALUE ||
    value === FILL_MODE.ORIGINAL,
  [INTENT.BORDER_COLOR]: value => typeof value === "string",
  [INTENT.BORDER_WEIGHT]: value => typeof value === "number",
  [INTENT.BORDER_VALUE]: isFillValueConfig,
  [INTENT.BORDER_STYLE_MODE]: value =>
    value === FILL_MODE.SOLID ||
    value === FILL_MODE.VALUE ||
    value === FILL_MODE.ORIGINAL,
  [INTENT.OPACITY]: value => typeof value === "number",
  [INTENT.ZOOM_RANGE]: value => Array.isArray(value),
  // A finite number only: Infinity cannot reach the leaf, and a non-finite
  // stored value would make the row fall back to the author's radius while
  // still advertising provenance.
  [INTENT.SIZE]: value => typeof value === "number" && Number.isFinite(value),
  [INTENT.ICON]: isIconIntent,
  [INTENT.NAME]: value => typeof value === "string",
  [INTENT.LABEL]: value => value != null,
};

/** The provenance-tracked style dims `dropRow` clears with the layer — an
 *  identity map onto `INTENT`, so a new `LayerOverride` must pick its intent
 *  key here (a compile error until it does). `name` / `label` are riders
 *  outside this set, cleared by their own callers (manager delete / label
 *  destroy). */
const STYLE_KEYS = {
  visible: INTENT.VISIBLE,
  fillColor: INTENT.FILL_COLOR,
  fillOpacity: INTENT.FILL_OPACITY,
  fillValue: INTENT.FILL_VALUE,
  fillMode: INTENT.FILL_MODE,
  borderColor: INTENT.BORDER_COLOR,
  borderWeight: INTENT.BORDER_WEIGHT,
  borderValue: INTENT.BORDER_VALUE,
  borderStyleMode: INTENT.BORDER_STYLE_MODE,
  opacity: INTENT.OPACITY,
  zoomRange: INTENT.ZOOM_RANGE,
  size: INTENT.SIZE,
  icon: INTENT.ICON,
} as const satisfies Record<LayerOverride, IntentKey>;

export {
  FILL_MODE,
  ICON_KIND,
  INTENT,
  isFillValueConfig,
  isIconIntent,
  LIVE,
  STYLE_KEYS,
};
export type {
  LabelConfig,
  FillMode,
  FillValueConfig,
  IconIntent,
  IntentKey,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
};
