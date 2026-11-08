// core/layer/filterStore — one per-layer, multi-source filter record.
//
// A map hosts several filter-capable surfaces (a data-layer's feature filter
// today, a measurement type filter, an aggregation include set). Each used to
// own its own storage key, its own ownership flag and its own reset path, so
// adding a surface meant re-wiring persistence by hand. This module is the
// single home for that state: one storage key, one record indexed by layer
// id, one `sources` map keyed by surface name, and one reset entry point.
//
// A surface registers the variant bits it owns — how to normalize a candidate
// into its domain, where to write the committed filter (the carrier), and the
// optional side effects (publish / dimensions / counts). It does NOT persist
// and it does NOT clear: read, write and reset all go through this store, so
// there is no per-surface key to assemble and no per-surface teardown to
// forget. That is the whole point — the persistence lifecycle is not a
// surface concern, so it is not a surface callback.
//
// No DOM, no Leaflet. The host's `apply` is the only carrier the store
// touches, and the surface decides what that means (item visibility, an
// aggregation include set, a leaf hidden-class write).
import {
  type FilterDimension,
  type LayerFilter,
  type LayerFilterModel,
  filtersEqual,
} from "./filter.js";
import { loadRecord, saveRecord } from "#platform/storage.js";

/** The single storage key every layer's filter record lives under. One key,
 *  indexed by layer id inside the record — never a per-surface or per-layer
 *  key assembled at the call site. */
const FILTER_STORE_KEY = "foliplus_filter_store";

/** The persisted record: one entry per layer, one source entry per surface.
 *  `touched` is the ownership flag — it is stored next to the value so there
 *  is exactly one copy of "did the user take this slot" in the codebase. */
interface PersistedSource {
  touched: boolean;
  value: LayerFilter;
}
interface PersistedLayers {
  [layerId: string]: { sources: { [name: string]: PersistedSource } };
}
interface PersistedRecord {
  version: number;
  layers: PersistedLayers;
}

const RECORD_VERSION = 1;

/** The variant bits a surface supplies. The store owns the orchestration
 *  (normalize -> compare -> store -> apply -> publish) and the persistence;
 *  the surface owns its domain. None of these callbacks may read or write
 *  storage or perform a reset — that is the store's job alone, and letting a
 *  callback do it is how the per-surface teardown channel this module removes
 *  would grow back. */
interface FilterSourceHost {
  /** Clamp a candidate into the surface's domain. `undefined` means "no
   *  filter" — never a partially-applied condition. */
  normalize(filter: LayerFilter): LayerFilter;
  /** Write the committed filter to the surface's carrier. */
  apply(filter: LayerFilter): void;
  /** Announce the change. Absent = no notification. */
  publish?(filter: LayerFilter): void;
  /** The surface's filterable dimensions, in display order. */
  dimensions?(): ReadonlyArray<FilterDimension>;
  /** kept / total in the surface's own unit — a feature leaf, a hex cell or a
   *  measurement item are all valid, so the unit is never inferred here. */
  counts?(): { kept: number; total: number };
}

/** A filter store bound to one layer. Register a surface, then read and write
 *  its filter through the store; reset clears one source or the whole layer. */
interface FilterStore {
  /** Register (or re-register) a surface's variant bits. Idempotent by name:
   *  re-registering replaces the host and keeps the stored value, so a control
   *  rebuild does not drop what the user set. */
  register(name: string, host: FilterSourceHost): void;
  /** The registered surface names, in registration order. */
  sources(): readonly string[];
  /** Panel write path: normalize -> compare -> store -> apply -> publish.
   *  Returns whether the write was applied (false = a no-op the caller may
   *  skip its own side effects for). */
  setFilter(layerId: string, name: string, filter: LayerFilter | undefined): boolean;
  /** The committed filter for one source (`undefined` = none). */
  getFilter(layerId: string, name: string): LayerFilter | undefined;
  /** Whether the user owns the slot (the declaration may not re-seed). */
  isOwned(layerId: string, name: string): boolean;
  /** Seed a source from a persisted record, or from its declaration when the
   *  user never owned the slot. */
  restore(layerId: string, name: string, declared: LayerFilter): LayerFilter;
  /** Factory reset. With `source`: drop that one surface's value and return
   *  it to its declaration, leaving every other surface on the layer intact.
   *  Without `source`: drop the whole layer's record (a layer delete, not a
   *  panel reset — never call this from a Reset button). Repaint-free; the
   *  caller owns carrier teardown via its own `apply`. */
  reset(layerId: string, source?: string): void;
  /** The model a filter panel renders for one source. */
  filterModel(layerId: string, name: string): LayerFilterModel;
}

const createFilterStore = (): FilterStore => {
  /** name -> host, per registration order. One registry serves every layer;
   *  the per-layer state lives in the persisted record. */
  const hosts = new Map<string, FilterSourceHost>();

  const readRecord = (): PersistedRecord =>
    loadRecord<PersistedRecord>(FILTER_STORE_KEY) ?? {
      version: RECORD_VERSION,
      layers: {},
    };

  const writeRecord = (record: PersistedRecord): void => {
    saveRecord(FILTER_STORE_KEY, record);
  };

  /** Read one source entry WITHOUT mutating the record. Reads must never
   *  write: a partial or corrupt record (a layer with no sources map yet) has
   *  to read back as un-owned rather than throw or get "fixed" as a side
   *  effect. Callers that intend to change the entry go through commit. */
  const sourceOf = (
    record: PersistedRecord,
    layerId: string,
    name: string,
  ): PersistedSource =>
    record.layers[layerId]?.sources?.[name] ?? {
      touched: false,
      value: undefined as LayerFilter,
    };

  /** Attach and persist one source entry. Unlike the read path (`sourceOf`),
   *  a write has to place the entry into the record — a missing layer or source
   *  is created here, explicitly, so persistence stays a write-side concern. */
  const commit = (
    layerId: string,
    name: string,
    next: LayerFilter,
    touched: boolean,
  ): void => {
    const record = readRecord();
    const layer = record.layers[layerId] ?? { sources: {} };
    record.layers[layerId] = layer;
    layer.sources[name] = { touched, value: next };
    writeRecord(record);
  };

  const store: FilterStore = {
    register(name, host) {
      hosts.set(name, host);
    },
    sources: () => [...hosts.keys()],
    setFilter(layerId, name, filter) {
      const host = hosts.get(name);
      if (!host) return false;
      const current = store.getFilter(layerId, name);
      const owned = store.isOwned(layerId, name);
      const next = host.normalize(filter);
      // A write that changes nothing is a no-op once the user owns the slot.
      // Clearing a slot that already holds nothing is also not a choice to
      // remember — the declaration may still seed. Every other write is the
      // user taking the slot, including re-affirming a seeded filter.
      if (filtersEqual(next, current) && (owned || next === undefined)) return false;
      commit(layerId, name, next, true);
      host.apply(next);
      host.publish?.(next);
      return true;
    },
    getFilter(layerId, name) {
      return sourceOf(readRecord(), layerId, name).value;
    },
    isOwned(layerId, name) {
      return sourceOf(readRecord(), layerId, name).touched;
    },
    restore(layerId, name, declared) {
      const entry = sourceOf(readRecord(), layerId, name);
      // A slot the user never took shows the declaration; a slot they took
      // shows what they set, even across a reload.
      return entry.touched ? entry.value : declared;
    },
    reset(layerId, source) {
      const record = readRecord();
      const layer = record.layers[layerId];
      if (!layer) return;
      if (source === undefined) {
        // Whole-layer reset: a layer delete. Every surface on this layer goes.
        delete record.layers[layerId];
        writeRecord(record);
        return;
      }
      const host = hosts.get(source);
      const entry = layer.sources[source];
      if (!entry) return;
      delete layer.sources[source];
      writeRecord(record);
      // Return the surface to its declaration and repaint through its own
      // carrier — the store never touches the carrier directly.
      const declared = entry.touched ? undefined : entry.value;
      host?.apply(declared);
      host?.publish?.(declared);
    },
    filterModel(layerId, name) {
      const host = hosts.get(name);
      const filter = store.getFilter(layerId, name);
      const dimensions = host?.dimensions?.() ?? [];
      const counts = host?.counts?.() ?? { kept: 0, total: 0 };
      return { dimensions, filter, ...counts };
    },
  };
  return store;
};

export { createFilterStore, FILTER_STORE_KEY };
export type { FilterSourceHost };
