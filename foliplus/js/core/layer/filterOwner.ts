// core/layer/filterOwner — shared filter orchestration controller.
//
// The semantic layer (filter.ts / filterFeature.ts) is already a single
// source. What each control copied was the *orchestration*: the setFilter
// path (normalize → store → apply → publish), the ownership flag that keeps a
// Python declaration from resurrecting a user-cleared slot, and the factory
// reset that returns to the declaration. This module lifts that orchestration
// into an owner-agnostic controller so a control supplies only its variant
// bits (normalize / apply / publish / persist / dimensions / counts) and
// reuses one setFilter / filterModel / restore / reset path.
//
// No DOM, no Leaflet — the host's `apply` is the only carrier the owner
// touches, and the control decides what that means (item visibility, an
// aggregation include set, a leaf hidden-class write).
import {
  type FilterDimension,
  type LayerFilter,
  type LayerFilterModel,
  filtersEqual,
} from "./filter.js";

/** Per-source store routing for an owner whose committed filter lives in a
 *  per-source map (the Heatmap filters one source layer at a time) rather
 *  than a single value (the Measure has one filter for its one row). When the
 *  host supplies a slot, the owner's getFilter / isOwned / setFilter read and
 *  write the slot's store instead of the internal single-filter state, and the
 *  slot's store equality is the write authority — so the owner becomes a pure
 *  orchestrator over a store it does not own. A host that mutates its store
 *  outside the owner (a per-source restore, a factory reset) stays consistent
 *  because the owner reads the slot live. */
interface FilterOwnerSlot {
  /** Read the active source's committed filter (undefined = none). */
  read(): LayerFilter | undefined;
  /** Write the active source's committed filter. Returns whether the store
   *  changed — the store's equality is authoritative, so a no-op write is
   *  detectable even when the owner already compared values. */
  write(filter: LayerFilter | undefined): boolean;
  /** Read the ownership flag (a declaration may not re-seed). */
  readOwned(): boolean;
  /** Write the ownership flag. */
  writeOwned(owned: boolean): void;
}

/** The variant bits a control supplies. The owner supplies the orchestration;
 *  the host supplies the domain (normalize), the carrier write (apply), and
 *  the optional side effects (publish / persist / clearPersist / dimensions /
 *  counts). */
interface FilterOwnerHost {
  /** Clamp a candidate into the owner's domain (extent clamp, enum domain).
   *  `undefined` means "no filter" — never a partially-applied condition. */
  normalize(filter: LayerFilter): LayerFilter;
  /** Write the committed filter to the owner's carrier (item visibility, an
   *  aggregation include set, a leaf hidden-class write). */
  apply(filter: LayerFilter): void;
  /** Announce the change. Absent = no notification. */
  publish?(filter: LayerFilter): void;
  /** Persist the committed filter plus its ownership flag. Absent = the owner
   *  keeps no record (a pure session filter). */
  persist?(filter: LayerFilter, owned: boolean): void;
  /** Drop the persisted record (factory reset). Absent = no-op. */
  clearPersist?(): void;
  /** The owner's filterable dimensions, in display order. */
  dimensions?(): ReadonlyArray<FilterDimension>;
  /** kept / total in the owner's own unit — a hex cell, a feature leaf, or a
   *  measurement item are all valid, so the unit is never inferred here. */
  counts?(): { kept: number; total: number };
  /** Per-source store routing (the Heatmap). Absent = the owner holds a single
   *  committed value (the Measure). When present, the slot is the owner's
   *  single source of truth and the internal current/owned state is bypassed. */
  slot?: FilterOwnerSlot;
}

/** The shared filter controller one control builds. */
interface FilterOwner {
  /** Panel write path: normalize → compare → store → apply → publish.
   *  Returns whether the write was applied (false = a no-op the caller may
   *  skip its own side effects for). */
  setFilter(filter: LayerFilter | undefined): boolean;
  /** The committed filter (undefined = none). */
  getFilter(): LayerFilter | undefined;
  /** Whether the user owns the slot (the declaration may not re-seed). */
  isOwned(): boolean;
  /** The declaration this owner re-seeds from on the factory reset. */
  declared(): LayerFilter | undefined;
  /** Set the normalized declaration (computed once at construction). */
  setDeclaration(declared: LayerFilter): void;
  /** Seed from a persisted record, or the declaration when the user never
   *  owned the slot. */
  restore(filter: LayerFilter | undefined, touched: boolean): void;
  /** Factory reset: drop ownership, clear the record, return to the
   *  declaration. Repaint-free — the caller owns carrier teardown. */
  reset(): void;
  /** The model the filter panel renders. */
  filterModel(): LayerFilterModel;
}

/** Build a filter owner over a control's variant bits. The owner holds the
 *  current filter and the ownership flag; the host is read-only from here. */
const createFilterOwner = (host: FilterOwnerHost): FilterOwner => {
  let current: LayerFilter = undefined;
  let owned = false;
  let declared: LayerFilter = undefined;
  const slot = host.slot;

  const owner: FilterOwner = {
    setFilter(filter: LayerFilter | undefined): boolean {
      const next = host.normalize(filter);
      // The slot's store equality is authoritative (a per-source write can be
      // a no-op for a store the owner has never seen). Without a slot the
      // single-value comparison is the owner's.
      const unchanged = slot ? !slot.write(next) : filtersEqual(next, current);
      // A write that changes nothing is a no-op once the user owns the slot.
      // Clearing a slot that already holds nothing is also not a choice to
      // remember (the panel's Clear is disabled in that state) — the
      // declaration may still seed. Every other write is the user taking the
      // slot, including re-affirming the filter the declaration seeded.
      // Slot mode keeps the host store's contract instead: an unchanged
      // per-source write is a complete no-op — it never re-takes ownership
      // (the Heatmap's storeFilter early-return), because the store's own
      // equality already answered the "did the user say anything new?"
      // question. The single-value mode is the Measure's rule above.
      if (unchanged && (slot || owned || next === undefined)) return false;
      current = next;
      owned = true;
      if (slot) slot.writeOwned(true);
      host.persist?.(next, true);
      host.apply(next);
      host.publish?.(next);
      return true;
    },
    getFilter: () => (slot ? slot.read() : current),
    isOwned: () => (slot ? slot.readOwned() : owned),
    declared: () => declared,
    setDeclaration(value) {
      declared = value;
    },
    restore(filter, touched) {
      owned = touched;
      if (slot) {
        slot.write(touched ? filter : declared);
        slot.writeOwned(touched);
        return;
      }
      current = touched ? filter : declared;
    },
    reset() {
      host.clearPersist?.();
      owned = false;
      if (slot) {
        slot.write(undefined);
        slot.writeOwned(false);
        return;
      }
      if (current === declared) return;
      current = declared;
      host.publish?.(current);
    },
    filterModel() {
      return {
        dimensions: host.dimensions?.() ?? [],
        filter: slot ? slot.read() : current,
        ...(host.counts ? host.counts() : { kept: 0, total: 0 }),
      };
    },
  };
  return owner;
};

export { createFilterOwner };
export type { FilterOwner, FilterOwnerHost, FilterOwnerSlot };
