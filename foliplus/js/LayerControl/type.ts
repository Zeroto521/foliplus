// LayerControl shared type definitions — persistence record schema and
// annotation config/label contracts. Pure types: everything here is erased at
// build, so persistence and annotation sub-modules can import without pulling
// value code.
//
// Intent-domain types (LayerOverride / LayerIntent / PersistedLayerState /
// IntentRow / LoadSource / AnnotationConfig) and the projection types
// (Projection / AppliedProjection) were sunk to core/layer — the
// barrel below re-exports them so every existing `LayerControl/type` import
// keeps working unchanged. `PersistedLayerState` is also imported locally
// because `PersistedRecord.layers` names it directly.
import type { PersistedLayerState } from "#core/layer/index.js";
import type { LayerDimKey } from "#core/layer/type.js";
import type { LayerUI } from "./ui/index.js";

export type {
  AnnotationConfig,
  AppliedProjection,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
  Projection,
} from "#core/layer/index.js";

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
   *  It is read at the registration entry point alone (`LayerController
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

/** A leaf whose `setStyle` is there for real. Narrowing through a guard
 *  rather than a `typeof` test keeps call sites plain method calls, which
 *  matters: Leaflet's `Path.setStyle` runs `setOptions(this, style)`, so a
 *  method captured into a local and called detached would see `this` as
 *  undefined and throw instead of writing. */
type StyleSetter = {
  setStyle: (style: Record<string, unknown>) => void;
  on?: (type: string, fn: () => void) => void;
};

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
  /** Cohesive user write: persist the patch through LayerIntentStore (`set`
   *  marks provenance) then schedule the styleBag landing. Partial patch —
   *  omitted keys leave that sub-dimension untouched. */
  write?: (ui: LayerUI, layerId: string, patch: Partial<D> | D) => void;
  /** Cohesive reset: drop the dimension's LayerIntentStore rows (values +
   *  provenance) and restore the author's styleBag face. */
  reset?: (ui: LayerUI, layerId: string) => void;
  /** Three-state source of the effective value. Gate rejects → `"none"`;
   *  store provenance → `"user"`; otherwise `"author"`. */
  valueSource?: (ui: LayerUI, layerId: string) => DimensionValueSource;
};

export type { DimensionValueSource, LayerDimension, PersistedRecord, StyleSetter };
