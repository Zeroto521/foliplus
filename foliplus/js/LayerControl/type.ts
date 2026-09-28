// LayerControl shared type definitions — persistence record schema and
// annotation config/label contracts. Pure types: everything here is erased at
// build, so persistence and annotation sub-modules can import without pulling
// value code.
import { type NumberStyle } from "#common/format.js";

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
  /** Runtime paint overrides — fall back to the shared --label-* tokens. */
  color: string;
  size: number;
  format: NumberStyle;
  /** Whether this layer's own labels thin themselves out where they overlap. */
  collide: boolean;
}

export type {
  AnnotationConfig,
  LayerLabel,
  LayerOverride,
  LiveState,
  PersistedLayerState,
  PersistedRecord,
};
