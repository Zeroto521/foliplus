// MeasureControl store — single entry point for measurement data lifecycle.
//
// Encapsulates the measurements array, id counter, persistence (localStorage),
// and LAYER_ITEM_COUNT_CHANGE emission. Call sites (modes, ui, export) go
// through this store instead of poking manager.measurements + saveMeasurements
// directly, mirroring LayerControl's persistence.ts convention: one store
// class, keys in const.ts STORAGE, no direct Storage access outside.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see global.d.ts).

/**
 * Central store for all measurements. Owns the array, the id counter, and the
 * persist + count-emit side effects. Manager exposes a thin compatibility
 * shell (`.measurements` getter/setter, `.saveMeasurements()`) over this so
 * browser tests and legacy call sites keep working while new code uses the
 * typed API (add/remove/update/all).
 */
class MeasureStore {
  private list: MeasureData[] = [];
  private counter = 0;
  private readonly map: L.Map;
  private readonly layerId: string;

  constructor(map: L.Map, layerId: string) {
    this.map = map;
    this.layerId = layerId;
  }

  /** Current measurements (live reference — mutating it without a store method
   *  will NOT persist; use add/remove/update/clear). */
  all(): MeasureData[] {
    return this.list;
  }

  /** Live count, used by LayerControl's featureCountProvider. */
  count(): number {
    return this.list.length;
  }

  // ── Persistence ────────────────────────────────────────────────────

  /** Load measurements from localStorage (defensive: non-array → []). */
  load(): MeasureData[] {
    const data = Storage.load<MeasureData[]>(CONST.STORAGE.KEY, CONF.name);
    return Array.isArray(data) ? data : [];
  }

  /** Replace the in-memory list without persisting (used by restore, which
   *  rebuilds UI then emits count separately). Mutates the backing array in
   *  place so callers holding an `all()` reference stay on the same object. */
  hydrate(data: MeasureData[]): void {
    this.list.splice(0, this.list.length, ...data);
  }

  /** Persist current list to localStorage and emit LAYER_ITEM_COUNT_CHANGE so
   *  LayerControl refreshes its count column. */
  persist(): void {
    Storage.save(CONST.STORAGE.KEY, this.list, CONF.name);
    this.emitCount();
  }

  /** Emit LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes the count column
   *  without a write (e.g. after restore). */
  emitCount(): void {
    ensureEvents(this.map).emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, {
      id: this.layerId,
    });
  }

  // ── Id generation ──────────────────────────────────────────────────

  /** Generate a unique measurement id, e.g. "foliplus_measure_marker_..._1".
   *  Persisted with the measurement and exported (CSV / GeoJSON). */
  nextId(type: string): string {
    this.counter += 1;
    return `${CONST.ID}_${type}_${Date.now()}_${this.counter}`;
  }

  // ── Mutations (each persists + emits) ───────────────────────────────

  /** Add a measurement and persist. */
  add(data: MeasureData): void {
    this.list.push(data);
    this.persist();
  }

  /** Remove all measurements matching the id and persist. */
  remove(id: string): void {
    this.list.splice(0, this.list.length, ...this.list.filter(x => x.id !== id));
    this.persist();
  }

  /** Merge a patch into a measurement by id and persist. No-op if not found
   *  (callers already guard the drag binding that triggers updates). */
  update(id: string, patch: Partial<MeasureData>): void {
    const m = this.list.find(x => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    this.persist();
  }

  /** Remove all measurements and persist. */
  clear(): void {
    this.list.splice(0, this.list.length);
    this.persist();
  }
}

export { MeasureStore };
