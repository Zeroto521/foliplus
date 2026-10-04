// LayerControl shared type definitions — persistence record schema and
// annotation config/label contracts. Pure types: everything here is erased at
// build, so persistence and annotation sub-modules can import without pulling
// value code.
//
// Intent-domain types (LayerOverride / LayerIntent / PersistedLayerState /
// IntentRow / LoadSource / AnnotationConfig) and the projection types
// (Projection / AppliedProjection) were sunk to core/layer with T270 — the
// barrel below re-exports them so every existing `LayerControl/type` import
// keeps working unchanged.
import type {
  AnnotationConfig,
  AppliedProjection,
  IntentRow,
  LayerIntent,
  LayerOverride,
  LoadSource,
  PersistedLayerState,
  Projection,
} from "#core/layer/index.js";
import type { LayerDimKey } from "#core/layer/type.js";
import type { LayerUI } from "./ui/index.js";
import type { OverlayPanel } from "./ui/overlayPanel.js";

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

/** One write the carrier dispatcher accepts. `opacity` and `zoomRange`
 *  being `undefined` mean "no user value" — a Reset back to the author's
 *  default — not "leave the carrier alone". */
type StateOp =
  | { type: "visible"; value: boolean }
  | { type: "opacity"; value: number | undefined }
  | { type: "zoomRange"; value: [number, number] | null };

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

export type {
  BorderRowBindTarget,
  BorderRowBuildTarget,
  DimensionValueSource,
  LayerDimension,
  LayerLabel,
  LiveState,
  PersistedRecord,
  StateOp,
  StyleSetter,
};
