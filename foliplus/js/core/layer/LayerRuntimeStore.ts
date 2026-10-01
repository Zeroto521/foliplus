// core — per-layer derived/transient state (LayerRuntimeStore).
//
// The runtime half of the base: `LayerIntentStore` holds what the user chose,
// `LayerRuntimeStore` holds what the map actually is — projection results,
// field caches, the author-visible snapshot, and (reserved) breaks caches.
// One row per layer id, O(1) lookup, dropped symmetrically with the intent row
// on unregister. Derived state only: nothing here is user input, and every
// entry is invalidatable (explicit invalidation, never a full re-scan).
import type { LabelField } from "#core/labelField.js";

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

/** One layer's runtime row. Absent axis = never derived (or invalidated):
 *  the collector re-derives on demand instead of rescanning. */
interface LayerRuntime {
  /** The projection the executor last wrote to the map, keyed by id (not by
   *  `layerInfo` identity) so a re-register of the same id keeps its
   *  projection across the swap. */
  applied?: AppliedProjection;
  /** Per-layer label-field cache (collectFields walks every feature). */
  fields?: LabelField[];
  /** The author's declared default per layer id, snapshotted once per id from
   *  the map membership at first sight. Folium ships the layer list without a
   *  visibility field, so the author's `show=` default reaches the UI only as
   *  the map state folium left behind when the panel boots — captured before
   *  the policy starts moving layers (see `intentVisibleOf`). */
  authorVisible?: boolean;
}

/** Row store for {@link LayerRuntime} — the derived/transient twin of
 *  `LayerIntentStore` (same row shape: Map by id, O(1), absent = untouched).
 *  One instance per map, created with the coordinator and dropped with it. */
class LayerRuntimeStore {
  private rows = new Map<string, LayerRuntime>();

  private ensure(id: string): LayerRuntime {
    let row = this.rows.get(id);
    if (!row) {
      row = {};
      this.rows.set(id, row);
    }
    return row;
  }

  /** The runtime row for a layer id, or undefined when nothing was ever
   *  derived for it. */
  get(id: string): LayerRuntime | undefined {
    return this.rows.get(id);
  }

  /** Every id that holds any runtime state. */
  ids(): string[] {
    return [...this.rows.keys()];
  }

  // ── applied (projection last-write) ────────────────────────────────

  getApplied(id: string): AppliedProjection | undefined {
    return this.rows.get(id)?.applied;
  }

  setApplied(id: string, applied: AppliedProjection): void {
    this.ensure(id).applied = applied;
  }

  deleteApplied(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    delete row.applied;
    this.prune(id);
  }

  // ── fields (label-field cache) ─────────────────────────────────────

  getFields(id: string): LabelField[] | undefined {
    return this.rows.get(id)?.fields;
  }

  setFields(id: string, fields: LabelField[]): void {
    this.ensure(id).fields = fields;
  }

  deleteFields(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    delete row.fields;
    this.prune(id);
  }

  // ── authorVisible (author-declared default snapshot) ───────────────

  getAuthorVisible(id: string): boolean | undefined {
    return this.rows.get(id)?.authorVisible;
  }

  setAuthorVisible(id: string, visible: boolean): void {
    this.ensure(id).authorVisible = visible;
  }

  hasAuthorVisible(id: string): boolean {
    return this.rows.get(id)?.authorVisible !== undefined;
  }

  deleteAuthorVisible(id: string): void {
    const row = this.rows.get(id);
    if (!row) return;
    delete row.authorVisible;
    this.prune(id);
  }

  // ── lifecycle ──────────────────────────────────────────────────────

  /** Drop a layer's whole runtime row — the delete-path hook, symmetric with
   *  `LayerIntentStore.dropRow`. Unregister deliberately keeps the row (a
   *  teardown is not a delete: a temporary component may re-register the same
   *  id and wants its projection / snapshot back), so only the delete path
   *  drops it. The intent side of that delete already runs via
   *  `dropPersistedLayerState`; the runtime-side wiring lands with the T270
   *  recycling work (contract point 4). */
  drop(id: string): void {
    this.rows.delete(id);
  }

  /** Wipe every row (coordinator destroy / tests). */
  clearAll(): void {
    this.rows.clear();
  }

  private prune(id: string): void {
    const row = this.rows.get(id);
    if (row && Object.keys(row).length === 0) this.rows.delete(id);
  }
}

export { LayerRuntimeStore };
export type { AppliedProjection, LayerRuntime, Projection };
