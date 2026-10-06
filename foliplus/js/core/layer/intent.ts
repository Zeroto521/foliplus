// core — per-layer user intent: types + vocabulary (the intent domain).
//
// Sunk from LayerControl: intent is a base-layer concept — third-party
// layers carry user intent too, so the row store and its types live beside the
// registry instead of inside the control. Moved verbatim from
// `LayerControl/type.ts` (LayerOverride / LayerIntent / PersistedLayerState /
// IntentRow / LoadSource / AnnotationConfig) and `LayerControl/ui/intent.ts`
// (INTENT / LIVE / STYLE_KEYS / IntentKey) — semantics unchanged.
import type { NumberStyle } from "#foliplus/config-schema.js";

/** Per-layer annotation config (matches what persistence stores). */
interface AnnotationConfig {
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
  | "borderColor"
  | "borderWeight"
  | "opacity"
  | "zoomRange";

/** One layer's live intent values — the in-memory twin of
 *  {@link PersistedLayerState} (same value shapes) plus `name`.
 *
 *  Absent key = the user never chose that dimension (the author's declared
 *  default stays in force). Provenance is a separate axis
 *  (`IntentRow.provenance` / `LayerOverride`) and is deliberately not on this
 *  record. Disk shape is unchanged: `buildLayerStates` / `renamedNames`
 *  remain the only persistence projections.
 *
 *  **Adding a dimension** (e.g. label visibility or label position):
 *  1. A *user-settable* dim with an author default (like `visible`) gains a
 *     key here + the same literal in `LayerOverride`, `INTENT` / `LIVE`
 *     (`core/layer/intent.ts`) and `PARSE_OVERRIDE` (`persistence.ts`) — the
 *     `Record<…>` pins fail the build until every one of them exists, and
 *     the value rides `layers[id]` under that key. Disk-shape growth is a
 *     separate, explicit task.
 *  2. A *label-only* field (position, …) belongs on {@link AnnotationConfig}
 *     instead: it nests under `layers[id].annotation`, needs no provenance
 *     entry, and flows through the tolerant annotation parse untouched —
 *     only the field rule in `coerceAnnotationFields` (ui/style/label.ts)
 *     and the renderer consume it. */
type LayerIntent = {
  /** Layer id → the user's visibility choice (true = shown). */
  visible?: boolean;
  fillColor?: string;
  fillOpacity?: number;
  borderColor?: string;
  borderWeight?: number;
  opacity?: number;
  zoomRange?: [number, number];
  /** User-assigned display name (replaces the layer's authored name). */
  name?: string;
  /** Label (annotation) config seed for this layer. Live label state after
   *  the seed applies still lives in AnnotationManager (`configEntries`). */
  annotation?: AnnotationConfig;
};

/** One layer's persisted intent: the values the user set, plus which dimensions
 *  they set them for. A value with no matching override is dropped on read. */
type PersistedLayerState = {
  visible?: boolean;
  /** The hex fill color the user picked in the style panel. LayerControl
   *  owns the write (a self-managed dimension — see ui/style/fill.ts), so
   *  it lives in this record rather than on the annotation config. */
  fillColor?: string;
  /** Fill opacity (0-1) the user set in the style panel. */
  fillOpacity?: number;
  /** The hex stroke color the user picked in the style panel. LayerControl
   *  owns the write (a self-managed dimension — see ui/style/border.ts), so
   *  it lives in this record rather than on the annotation config. */
  borderColor?: string;
  /** The stroke width the user set, in the shared border bounds. */
  borderWeight?: number;
  opacity?: number;
  /** The handle positions the user moved, [minZoom, maxZoom]. The author's
   *  min_zoom / max_zoom is only the starting value, so it reaches this field
   *  only once the user has dragged the handles. */
  zoomRange?: [number, number];
  /** The layer's label (annotation) config — a style dimension of this layer,
   *  not an override: it carries no provenance marker and survives alongside
   *  an empty `overrides` array (a layer the user configured *only* labels
   *  for is still an entry here). Readers fall back to the legacy
   *  top-level `annotations[id]` segment when this key is absent
   *  (write-new / read-old tolerance; the old segment is passed through
   *  untouched, never migrated). */
  annotation?: AnnotationConfig;
  overrides: LayerOverride[];
};

/** One layer's live intent row — the LayerIntentStore carrier shape. Value axis
 *  plus provenance axis in one record, so a half-write cannot desync them
 *  through the store's cohesive `set` / `clear`. Absent intent key = the user
 *  never chose that dimension; provenance only ever holds {@link LayerOverride}
 *  keys (`name` / `annotation` are riders without markers). */
type IntentRow = {
  intent: LayerIntent;
  provenance: Set<LayerOverride>;
};

/** The intent half of a parsed persistence record — what
 *  `LayerIntentStore.loadFromPersisted` accepts. A subset of
 *  `PersistedRecord` (order / removed / foldedGroups stay outside the
 *  store); annotation config rides both the legacy top-level segment and
 *  `layers[id].annotation`. */
type LoadSource = {
  renamedNames?: Record<string, string>;
  annotations?: Record<string, unknown>;
  layers?: Record<string, PersistedLayerState>;
};

/** The intent-key vocabulary — the one place each dimension's key is spelled.
 *  The `satisfies` guard pins every value to an existing `LayerIntent` key, so
 *  adding a dimension means touching this table and the record type together. */
const INTENT = {
  VISIBLE: "visible",
  FILL_COLOR: "fillColor",
  FILL_OPACITY: "fillOpacity",
  BORDER_COLOR: "borderColor",
  BORDER_WEIGHT: "borderWeight",
  OPACITY: "opacity",
  ZOOM_RANGE: "zoomRange",
  NAME: "name",
  ANNOTATION: "annotation",
} as const satisfies Record<string, keyof LayerIntent>;

type IntentKey = keyof LayerIntent;

/** Typed-presence rule per intent key — the one place the value vocabulary
 *  lives. An intent key's value is "live" when it has the type the record
 *  promises (0 / empty strings / empty arrays are real choices, not absence). */
const LIVE: Record<IntentKey, (value: unknown) => boolean> = {
  [INTENT.VISIBLE]: value => typeof value === "boolean",
  [INTENT.FILL_COLOR]: value => typeof value === "string",
  [INTENT.FILL_OPACITY]: value => typeof value === "number",
  [INTENT.BORDER_COLOR]: value => typeof value === "string",
  [INTENT.BORDER_WEIGHT]: value => typeof value === "number",
  [INTENT.OPACITY]: value => typeof value === "number",
  [INTENT.ZOOM_RANGE]: value => Array.isArray(value),
  [INTENT.NAME]: value => typeof value === "string",
  [INTENT.ANNOTATION]: value => value != null,
};

/** The provenance-tracked style dims `dropRow` clears with the layer — an
 *  identity map onto `INTENT`, so a new `LayerOverride` must pick its intent
 *  key here (a compile error until it does). `name` / `annotation` are riders
 *  outside this set, cleared by their own callers (manager delete / annotation
 *  destroy). */
const STYLE_KEYS = {
  visible: INTENT.VISIBLE,
  fillColor: INTENT.FILL_COLOR,
  fillOpacity: INTENT.FILL_OPACITY,
  borderColor: INTENT.BORDER_COLOR,
  borderWeight: INTENT.BORDER_WEIGHT,
  opacity: INTENT.OPACITY,
  zoomRange: INTENT.ZOOM_RANGE,
} as const satisfies Record<LayerOverride, IntentKey>;

export { INTENT, LIVE, STYLE_KEYS };
export type {
  AnnotationConfig,
  IntentKey,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
};
