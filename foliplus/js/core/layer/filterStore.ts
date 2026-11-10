// core/layer/filterStore — one per-layer, multi-source filter record.
//
// A map hosts several filter-capable surfaces (a data-layer's feature filter
// today, a measurement type filter, an aggregation include set). Each used to
// own its own storage key, its own ownership flag and its own reset path, so
// adding a surface meant re-wiring persistence by hand. This module is the
// single home for that state: one storage key, one record indexed by layer
// id, one source map keyed by (layerId, name), and one reset entry point.
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
import { ensureMapFoliplus } from "#core/lifecycle/mapApi.js";
import { createLogger } from "#platform/log.js";
import { loadRecord, removeRecord, saveRecord } from "#platform/storage.js";

/** The single storage key every layer's filter record lives under. One key,
 *  indexed by layer id inside the record — never a per-surface or per-layer
 *  key assembled at the call site. */
const FILTER_STORE_KEY = "foliplus_filter_store";

/** The well-known source names a surface registers under. A control whose
 *  filter surface is a single fixed slot (MeasureControl's type filter) names
 *  it here instead of spelling the string at every call site, so a typo cannot
 *  silently create a second record entry. A surface keyed by a dynamic source
 *  id (HeatmapControl's selected layer) does not need an entry. */
const FILTER_SOURCE = {
  MEASURE: "measure",
} as const;

const log = createLogger("filterStore");

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
interface FilterStoreRecord {
  version: number;
  layers: PersistedLayers;
}

const RECORD_VERSION = 1;

/** Composite host key. The store is a per-map singleton shared by every
 *  control, so a surface is identified by its owning layer AND its name: two
 *  heatmap controls on the same map can each register a source named
 *  "points", and the name alone would let the second registration overwrite
 *  the first. A NUL can never appear in a layer id or a source name, so it is
 *  a collision-free separator. */
const keyOf = (layerId: string, name: string): string => `${layerId}\u0000${name}`;

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
  /** Register (or re-register) a surface's variant bits for one layer. Keyed
   *  by (layerId, name), so two surfaces sharing a name on different layers
   *  never collide; re-registering the same (layerId, name) replaces the host
   *  idempotently (a control rebuild) and keeps the stored value. */
  registerHost(layerId: string, name: string, host: FilterSourceHost): void;
  /** The registered source names for one layer, in registration order. */
  sources(layerId: string): readonly string[];
  /** Panel write path: normalize -> compare -> store -> apply -> publish.
   *  Returns whether the write was applied (false = a no-op the caller may
   *  skip its own side effects for). */
  setFilter(layerId: string, name: string, filter: LayerFilter | undefined): boolean;
  /** The committed filter for one source (`undefined` = none). */
  getFilter(layerId: string, name: string): LayerFilter | undefined;
  /** Whether the user owns the slot (the declaration may not re-seed). */
  isOwned(layerId: string, name: string): boolean;
  /** Recover a persisted filter without normalising or applying it — the draw
   *  is the render path's job. Distinct from `setFilter` (a user operation:
   *  normalize + apply + ownership); `restore` writes value + touched=true
   *  and nothing else. Used by the old-record migration, where the stored
   *  filters are genuine user-saved state that must survive the move from the
   *  component's own key into this store. */
  restore(layerId: string, name: string, filter: LayerFilter): void;
  /** Read one source: the user's committed value when they took the slot,
   *  else `declared`. Read-only — never writes, never touches the record
   *  (a partial or corrupt record has to read back as un-owned rather than
   *  get "fixed" as a side effect). */
  resolve(layerId: string, name: string, declared: LayerFilter): LayerFilter;
  /** Capture a surface's Python-declared starting filter. Not persisted — a
   *  declaration is a construction-time constant, and persisting it would let
   *  a stale one win over a newer control config. `reset(layerId, name)`
   *  returns the surface to this value; an un-declared surface resets to
   *  undefined (or to its stored value when the record lost its ownership
   *  flag — see the reset guard test). */
  setDeclaration(layerId: string, name: string, declared: LayerFilter): void;
  /** Factory reset. With `source`: drop that one surface's value and return
   *  it to its declaration, leaving every other surface on the layer intact.
   *  Without `source`: drop the whole layer's record (a layer delete, not a
   *  panel reset — never call this from a Reset button). Repaint-free; the
   *  caller owns carrier teardown via its own `apply`. */
  reset(layerId: string, source?: string): void;
  /** Drop one source's persisted value AND its declaration without applying
   *  or publishing — the source (a data layer) is gone, and the caller owns
   *  the repaint (it clears the canvas itself). Distinct from `reset(layerId,
   *  source)`, which repaints the declaration; a departed source must not
   *  re-render the heatmap. No-op when the source has no record. */
  drop(layerId: string, source: string): void;
  /** The model a filter panel renders for one source. */
  filterModel(layerId: string, name: string): LayerFilterModel;
  /** Re-validate a source's filter against a snapshot-derived transform.
   *  Reads the current committed-or-declared value, applies `transform`, and
   *  if the result differs, updates the source (an owned slot keeps its
   *  ownership — a cleared-owned slot stays owned; a declaration-only slot
   *  follows the declaration, and a transform that empties it drops the
   *  declaration so the next seed re-establishes it). Returns whether the
   *  value changed. Never applies or publishes — the render path owns the
   *  repaint and the notification (a filter write during a render would
   *  double-publish). Used by the Heatmap's content/identity revalidation. */
  revalidate(
    layerId: string,
    name: string,
    transform: (current: LayerFilter | undefined) => LayerFilter | undefined,
  ): boolean;
}

const createFilterStore = (): FilterStore => {
  /** (layerId, name) -> host, per registration order. One registry serves
   *  every layer and every control; the per-layer state lives in the
   *  persisted record. */
  const hosts = new Map<string, FilterSourceHost>();
  /** layerId -> source -> declaration. In-memory only (see setDeclaration). */
  const declarations = new Map<string, Map<string, LayerFilter>>();

  const readRecord = (): FilterStoreRecord => {
    const loaded = loadRecord<unknown>(FILTER_STORE_KEY);
    // A corrupt or non-record payload (an array, a string, a record missing
    // the layers map) reads back as an empty record — it is not a persistence
    // channel and must never be trusted as one.
    if (
      !loaded ||
      typeof loaded !== "object" ||
      Array.isArray(loaded) ||
      !("layers" in loaded) ||
      typeof (loaded as { layers?: unknown }).layers !== "object" ||
      (loaded as { layers?: unknown }).layers === null
    ) {
      return { version: RECORD_VERSION, layers: {} };
    }
    return loaded as FilterStoreRecord;
  };

  const writeRecord = (record: FilterStoreRecord): void => {
    saveRecord(FILTER_STORE_KEY, record);
  };

  /** Read one source entry WITHOUT mutating the record. Reads must never
   *  write: a partial or corrupt record (a layer with no sources map yet) has
   *  to read back as un-owned rather than throw or get "fixed" as a side
   *  effect. Callers that intend to change the entry go through commit. */
  const sourceOf = (
    record: FilterStoreRecord,
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

  /** Remove one source's persisted value from the record (no apply, no
   *  publish). Shared by `reset` (which then repaints the declaration) and
   *  `drop` (which does not). Returns whether a source entry was removed. */
  const dropSource = (layerId: string, source: string): boolean => {
    const record = readRecord();
    const layer = record.layers[layerId];
    if (!layer?.sources?.[source]) return false;
    delete layer.sources[source];
    // A layer whose last source was cleared is empty: drop the layer entry
    // too, so a factory Reset on the only surface leaves no residue.
    if (Object.keys(layer.sources).length === 0) {
      delete record.layers[layerId];
    }
    // When no layer entry remains anywhere, remove the whole key (the old
    // per-surface clear removed the key it wrote). A record with sibling
    // layers keeps its other entries.
    if (Object.keys(record.layers).length === 0) {
      removeRecord(FILTER_STORE_KEY);
    } else {
      writeRecord(record);
    }
    return true;
  };

  const store: FilterStore = {
    registerHost(layerId, name, host) {
      const key = keyOf(layerId, name);
      if (hosts.has(key)) {
        // A control rebuild re-registers the same (layerId, name); the host
        // object is fresh but the stored value must survive. This is the
        // idempotent-overwrite contract, not an error.
        log.debug(`re-register host ${layerId}/${name}`);
      }
      hosts.set(key, host);
    },
    sources: layerId => {
      const names: string[] = [];
      const prefix = `${layerId}\u0000`;
      for (const key of hosts.keys()) {
        if (key.startsWith(prefix)) names.push(key.slice(prefix.length));
      }
      // A restored record carries source names that were never registered as
      // hosts (a migration restores into the record before any host exists).
      // Union those in so the record's sources stay visible — registration
      // order first, then record-only names.
      const record = readRecord();
      const persisted = record.layers[layerId]?.sources ?? {};
      for (const name of Object.keys(persisted)) {
        if (!names.includes(name)) names.push(name);
      }
      return names;
    },
    setFilter(layerId, name, filter) {
      const host = hosts.get(keyOf(layerId, name));
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
      const entry = sourceOf(readRecord(), layerId, name);
      // An un-persisted slot reads back as its declaration (a factory reset
      // cleared the record, and the declaration is the reset target) rather
      // than the void. A source with no declaration still reads undefined.
      return entry.touched ? entry.value : declarations.get(layerId)?.get(name);
    },
    isOwned(layerId, name) {
      return sourceOf(readRecord(), layerId, name).touched;
    },
    restore(layerId, name, filter) {
      // Recover a persisted filter verbatim: value + ownership, no normalize,
      // no apply. The render path owns the draw; `setFilter` is the user op
      // that both normalizes and applies. The declaration is left untouched —
      // a restored user value wins over it, exactly as it did on disk.
      commit(layerId, name, filter, true);
    },
    resolve(layerId, name, declared) {
      const entry = sourceOf(readRecord(), layerId, name);
      // A slot the user never took shows the declaration; a slot they took
      // shows what they set, even across a reload.
      return entry.touched ? entry.value : declared;
    },
    setDeclaration(layerId, name, declared) {
      let bySource = declarations.get(layerId);
      if (!bySource) {
        bySource = new Map();
        declarations.set(layerId, bySource);
      }
      bySource.set(name, declared);
    },
    reset(layerId, source) {
      const record = readRecord();
      const layer = record.layers[layerId];
      if (!layer) return;
      if (source === undefined) {
        // Whole-layer reset: a layer delete. Every surface on this layer goes.
        delete record.layers[layerId];
        if (Object.keys(record.layers).length === 0) {
          removeRecord(FILTER_STORE_KEY);
        } else {
          writeRecord(record);
        }
        declarations.delete(layerId);
        return;
      }
      const host = hosts.get(keyOf(layerId, source));
      const entry = layer.sources[source];
      if (!entry) return;
      // Remove the source's persisted value (shared with `drop`), keeping
      // the declaration — a source reset returns to it (the reset contract).
      dropSource(layerId, source);
      // Return the surface to its declaration and repaint through its own
      // carrier — the store never touches the carrier directly.
      const declared =
        declarations.get(layerId)?.get(source) ??
        (entry.touched ? undefined : entry.value);
      host?.apply(declared);
      host?.publish?.(declared);
    },
    drop(layerId, source) {
      const record = readRecord();
      const layer = record.layers[layerId];
      if (!layer?.sources?.[source]) return;
      dropSource(layerId, source);
      // A departed source is gone: its declaration is stale and must not
      // re-seed a future re-add of the same id. Only the persisted value and
      // the declaration are removed — no apply, no publish (the caller owns
      // the repaint; a departed source must not re-render the heatmap).
      declarations.get(layerId)?.delete(source);
    },
    filterModel(layerId, name) {
      const host = hosts.get(keyOf(layerId, name));
      const filter = store.getFilter(layerId, name);
      const dimensions = host?.dimensions?.() ?? [];
      const counts = host?.counts?.() ?? { kept: 0, total: 0 };
      return { dimensions, filter, ...counts };
    },
    revalidate(layerId, name, transform) {
      const entry = sourceOf(readRecord(), layerId, name);
      const declared = declarations.get(layerId)?.get(name);
      const current = entry.touched ? entry.value : declared;
      // Nothing to re-validate: no committed value and no declaration.
      if (current === undefined) return false;
      const next = transform(current);
      if (filtersEqual(next, current)) return false;
      if (entry.touched) {
        // An owned slot stays owned (a cleared-owned slot remains owned — the
        // user's empty choice is still theirs). The value follows the
        // transform.
        commit(layerId, name, next, true);
      } else if (next === undefined) {
        // A declaration the snapshot no longer supports is dropped; the next
        // seed re-establishes it against the fresh snapshot.
        declarations.get(layerId)?.delete(name);
      } else {
        declarations.get(layerId)?.set(name, next);
      }
      return true;
    },
  };
  return store;
};

/** Per-map singleton: one filter store per map, cached on the per-map
 *  namespace (mirrors ensureModes / ensureEvents). Every control on a map
 *  shares this instance, so surface registrations and the per-layer
 *  declarations are single-sourced across Measure / Heatmap / LayerControl. */
const ensureFilterStore = (map: L.Map): FilterStore => {
  const api = ensureMapFoliplus(map);
  api.filterStore ??= createFilterStore();
  return api.filterStore;
};

export { createFilterStore, ensureFilterStore, FILTER_SOURCE, FILTER_STORE_KEY };
export type { FilterSourceHost, FilterStore };
