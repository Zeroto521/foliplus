// LayerControl shared type definitions — persistence record schema and
// annotation config/label contracts. Pure types: everything here is erased at
// build, so persistence and annotation sub-modules can import without pulling
// value code.
import type { LayerDimKey } from "#core/layer/type.js";
import { type NumberStyle } from "#common/format.js";
import type { LayerUI } from "./ui/index.js";

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
  | "fillRamp"
  | "borderColor"
  | "borderWeight"
  | "opacity"
  | "zoomRange";

/** Value-based fill config (the "By value" mode of the fill dimension).
 *  Classifies `feature.properties[field]` by `method` into `classes`
 *  ordered classes, then maps each class to a colour from `scheme`
 *  (a chroma / ColorBrewer palette name). Persisted under
 *  `layerState.fillRamp`; mutually exclusive with the solid `fillColor` /
 *  `fillOpacity` overrides. */
type FillRampConfig = {
  field: string;
  method: string;
  classes: number;
  scheme: string;
};

/** One layer's live intent values — the in-memory twin of
 *  {@link PersistedLayerState} (same value shapes) plus `name`.
 *
 *  Absent key = the user never chose that dimension (the author's declared
 *  default stays in force). Provenance is a separate axis
 *  (`intentProvenance` / `LayerOverride`) and is deliberately not on this
 *  record. Disk shape is unchanged: `buildLayerStates` / `renamedNames`
 *  remain the only persistence projections.
 *
 *  **Adding a dimension** (e.g. label visibility or label position):
 *  1. A *user-settable* dim with an author default (like `visible`) gains a
 *     key here + the same literal in `LayerOverride`, `INTENT` / `LIVE`
 *     (`ui/intent.ts`) and `PARSE_OVERRIDE` (`persistence.ts`) — the
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
  /** Value-based fill config ("By value" mode). Mutually exclusive with
   *  `fillColor` / `fillOpacity` — switching mode clears the other side. */
  fillRamp?: FillRampConfig;
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
  /** Value-based fill config (the "By value" mode) — mutually exclusive
   *  with `fillColor` / `fillOpacity`; switching mode clears the other side.
   *  See {@link FillRampConfig}. */
  fillRamp?: FillRampConfig;
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

/** One layer's live intent row — the IntentStore carrier shape. Value axis
 *  plus provenance axis in one record, so a half-write cannot desync them
 *  through the store's cohesive `set` / `clear`. Absent intent key = the user
 *  never chose that dimension; provenance only ever holds {@link LayerOverride}
 *  keys (`name` / `annotation` are riders without markers). */
type IntentRow = {
  intent: LayerIntent;
  provenance: Set<LayerOverride>;
};

/** Compile-time pin: every provenance-tracked dimension is also a disk key —
 *  `buildLayerStates` writes each override straight through under its own
 *  name, so a new `LayerOverride` without a `PersistedLayerState` field fails
 *  here rather than being silently dropped at the persistence boundary. */
type _AssertOverridesAreDiskKeys = LayerOverride extends keyof PersistedLayerState
  ? true
  : ["every LayerOverride must be a PersistedLayerState key"];

/** Everything LayerControl persists, in one record per map. Intent only:
 *  declarations and derived state (what is actually on the map, z-indexes) are
 *  recomputed on every load and never written -- a zoom range is a declaration
 *  until the user moves the handles, which turns it into intent.
 *
 *  `version` is present on every write (stamped by `mergeFields`), and the
 *  only place a reader distinguishes shape: `parseRecord` copies a stored
 *  `version` through only when it matches `RECORD_VERSION`, otherwise the
 *  segment is dropped and the next write re-stamps it. Older records, which
 *  have no `version` at all, fall through the same branch and are stamped on
 *  the next write — no migration, no data loss on read. */
type PersistedRecord = {
  version: number;
  /** Layer ids in the panel's order, or null when the user never reordered. */
  order: string[] | null;
  /** Layer ids the user deleted, in the order they were deleted.
   *
   *  One-way: nothing removes an entry and `deleteLayer` is the only writer.
   *  It is read at the registration entry point alone (`LayerManager
   *  .registerLayer`) so a deleted id can never re-enter the registry;
   *  nothing downstream consults it, because a deleted id is simply never
   *  registered and so never reaches them. */
  removed: string[];
  foldedGroups: string[];
  /** Layer id → user-assigned display name. */
  renamedNames: Record<string, string>;
  /** Layer id → annotation config (show/field/format) — the LEGACY segment,
   *  superseded by `layers[id].annotation`. Kept for read tolerance: old
   *  records are read from here when the new key is absent, and every write
   *  passes the stored segment through unchanged (write-new / read-old, no
   *  migration — the segment dies when the record does). */
  annotations: Record<string, unknown>;
  /** Layer id → the user's per-layer intent. Empty means the user changed
   *  nothing, so every layer falls back to its declared default. */
  layers: Record<string, PersistedLayerState>;
};

/** The live sources a write reads. Supply only the dimensions you own -- a
 *  dimension you omit is left exactly as it stands in storage, so a caller that
 *  only knows the layer order cannot wipe the fold, rename, and label state it
 *  never touched. */
type LiveState = {
  order?: () => string[];
  removed?: () => string[];
  foldedGroups?: () => string[];
  renamedNames?: () => Record<string, string>;
  layers?: () => Record<string, PersistedLayerState>;
};

/** The intent half of a parsed persistence record — what
 *  `IntentStore.loadFromPersisted` accepts. A subset of
 *  {@link PersistedRecord} (order / removed / foldedGroups stay outside the
 *  store); annotation config rides both the legacy top-level segment and
 *  `layers[id].annotation`. */
type LoadSource = {
  renamedNames?: Record<string, string>;
  annotations?: Record<string, unknown>;
  layers?: Record<string, PersistedLayerState>;
};

/** A label a layer asked for, described by its feature rather than by pixels —
 *  the plan converts the latlng on every frame, so a pan leaves no stale
 *  coordinates behind. */
interface LayerLabel {
  id: string;
  text: string;
  latlng: L.LatLng;
  atPoint: boolean;
  priority: number;
}

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

/** One write the carrier dispatcher accepts. `opacity` and `zoomRange`
 *  being `undefined` mean "no user value" — a Reset back to the author's
 *  default — not "leave the carrier alone". */
type StateOp =
  | { type: "visible"; value: boolean }
  | { type: "opacity"; value: number | undefined }
  | { type: "zoomRange"; value: [number, number] | null };

/** One layer's projection: intent (persisted) and the derived policy state
 *  together, so a diff sees both in one comparison.
 *
 *  `intent.visible` is what the checkbox shows — the user's choice when they
 *  made one, otherwise the author's declared default.
 *  `effectiveShown` is the composite `intent && policy` and is what the
 *  executor writes to map membership. Only `intent` may authorise display;
 *  `policy` (focus, zoom range) may only suppress it. That is the invariant
 *  that keeps a derived dimension from ever adding a layer back onto the
 *  map — the class of bug the quickstart regression records, and the structural root of the
 *  one-way gate that used to live in state.ts.
 */
interface Projection {
  id: string;
  intent: { visible: boolean };
  effectiveShown: boolean;
  opacity: number | undefined;
  zoomRange: [number, number] | null;
}

/** The executor's projection snapshot: the pure projection plus the carrier
 *  identity the last write landed on. Recording carrier is what closes
 *  value-only diff misses writes when a carrier element is replaced (a
 *  re-registered canvas, a lazily-created annotation pane), because the
 *  stored numeric opacity matches but the DOM in front of it is new.
 *  The token is opaque: a canvas element, a pane-names array, or an
 *  `options` object reference. */
interface AppliedProjection extends Projection {
  carrier: unknown;
}

/** A leaf whose `setStyle` is there for real. Narrowing through a guard
 *  rather than a `typeof` test keeps call sites plain method calls, which
 *  matters: Leaflet's `Path.setStyle` runs `setOptions(this, style)`, so a
 *  method captured into a local and called detached would see `this` as
 *  undefined and throw instead of writing. */
type StyleSetter = {
  setStyle: (style: Record<string, unknown>) => void;
  on?: (type: string, fn: () => void) => void;
};

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

/** Who currently owns this dimension's effective value. `"user"` — the
 *  store holds a provenance marker; `"author"` — declared default still in
 *  force; `"none"` — the gate rejects the layer for this dimension (an
 *  unfilled dimension is not "user" and not "author"). */
type DimensionValueSource = "user" | "author" | "none";

/** One per-layer dimension. `key` is the persistence-identifier and the
 *  registry key — one of `DIM`'s names (`"opacity"`, `"fill"`, `"border"`,
 *  `"zoomRange"`, `"annotation"`), typed by `LayerDimKey` so the vocabulary
 *  cannot drift from `DIM`. Persistence provenance is a different face
 *  (`LayerOverride`: `"fillColor"`, `"visible"`, …).
 *
 *  `write` / `reset` / `valueSource` are optional slots. Migrated
 *  dimensions (fill, border) own the intent+persist orchestration here;
 *  styleBag still owns the setStyle landing (commitStyleDim /
 *  restoreStyleDim / scheduleStyleDimApply) and is called from write/reset.
 *  Unmigrated dimensions keep their named helpers until a later PR. */
type LayerDimension<D = unknown> = {
  key: LayerDimKey;
  /** Row-honest gate, two layers in order:
   *  1. **Layer existence** — return `false` when the layer is not in the
   *     registry (a precondition guard against a programming error).
   *  2. **Capability** — `capabilities.{dim} !== "none"`, the surface's
   *     declared capability is the single source of truth for whether this
   *     row is honest to render.
   *  Nothing else: no carrier probes, no `isColorBasemap` special-cases,
   *  no canvas/styleSetters exclusion (a canvas-only surface already
   *     declares `"none"` for the dimension it can't carry, so the gate
   *  rejects it naturally). See the registry file header for the full
   *  invariant. */
  gate: (ui: LayerUI, layerId: string) => boolean;
  /** Resolved current value — the user's stored override, falling back to
   *  the author's declared default when the user has never touched the
   *  dimension. `undefined` when the layer is not in the registry. */
  value: (ui: LayerUI, layerId: string) => D | undefined;
  /** Build the style-panel row. The descriptor owns the DOM shape; the
   *  panel still owns event binding, because binding needs the row's
   *  parent (the panel root) to install the drag bubble and shared
   *  number-field commit handler. */
  row: (ui: LayerUI, layerId: string) => HTMLElement;
  /** Cohesive user write: persist the patch through IntentStore (`set`
   *  marks provenance) then schedule the styleBag landing. Partial patch —
   *  omitted keys leave that sub-dimension untouched. */
  write?: (ui: LayerUI, layerId: string, patch: Partial<D> | D) => void;
  /** Cohesive reset: drop the dimension's IntentStore rows (values +
   *  provenance) and restore the author's styleBag face. */
  reset?: (ui: LayerUI, layerId: string) => void;
  /** Three-state source of the effective value. Gate rejects → `"none"`;
   *  store provenance → `"user"`; otherwise `"author"`. */
  valueSource?: (ui: LayerUI, layerId: string) => DimensionValueSource;
};

export type {
  AnnotationConfig,
  AppliedProjection,
  BorderRowBindTarget,
  BorderRowBuildTarget,
  DimensionValueSource,
  FillRampConfig,
  IntentRow,
  LayerDimension,
  LayerIntent,
  LayerLabel,
  LayerOverride,
  LiveState,
  LoadSource,
  PersistedLayerState,
  PersistedRecord,
  Projection,
  StateOp,
  StyleSetter,
};
