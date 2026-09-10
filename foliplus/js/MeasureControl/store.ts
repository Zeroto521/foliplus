// MeasureControl store — single entry point for measurement data lifecycle.
//
// Encapsulates the measurements array, id counter, persistence (localStorage),
// and LAYER_ITEM_COUNT_CHANGE emission. Call sites (modes, ui, export) go
// through this store instead of poking manager.measurements + saveMeasurements
// directly, mirroring LayerControl's persistence.ts convention: one store
// class, keys in const.ts STORAGE, no direct Storage access outside.
import { EVENTS, ensureEvents } from "#core/event/index.js";
import { HINT_DURATION } from "#core/hint.js";
import { createScopedTranslator } from "#common/locale.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

/** Central store for all measurements. Owns the array, the id counter, the
 * persist-failure notification, and LAYER_ITEM_COUNT_CHANGE emission. Manager
 * exposes a thin compatibility shell (`.measurements` getter/setter,
 * `.saveMeasurements()`) over this so browser tests and legacy call sites keep
 * working while new code uses the typed API (add/remove/update/all). */
class MeasureStore {
  private list: MeasureData[] = [];
  private counter = 0;
  private readonly map: L.Map;
  private readonly layerId: string;
  private warned = false;
  // CONF is a free variable from the IIFE template wrapper (see global.d.ts);
  // bind the translator once, not per call site.
  private readonly T = createScopedTranslator(CONF);

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

  /** Restore an id onto a measurement that came back from storage without one
   *  (older versions persisted measurements without an id). Returns true if
   *  any measurement gained an id — the caller then persists so the id is
   *  durable and later onUpdate / onDelete lookups resolve to the right row. */
  assignMissingIds(): boolean {
    let assigned = false;
    for (const m of this.list) {
      if (!m.id) {
        m.id = this.nextId(m.type);
        assigned = true;
      }
    }
    return assigned;
  }

  /** Persist current list to localStorage and emit LAYER_ITEM_COUNT_CHANGE so
   *  LayerControl refreshes its count column.
   *
   *  A rejected write is surfaced, because this list is unbounded — unlike the
   *  other persistence callers (bounded id arrays, a single bounds pair), a long
   *  chain here can fill the quota. It is reported once per store: the state is
   *  environmental (third-party cookies off, the origin's quota taken by other
   *  tabs) so it cannot be fixed from the page, and persist() runs on every
   *  measurement change — repeating the hint on each click is only noise. The
   *  data stays live in memory and on the map; only the reload-restorable copy
   *  is lost, which is what the message says. Count emission still runs, so the
   *  LayerControl count column keeps tracking the live list. */
  persist(): void {
    if (!Storage.save(CONST.STORAGE.KEY, this.list, CONF.name) && !this.warned) {
      this.warned = true;
      this.map.foliplus?.showHint?.(
        CONF.name,
        this.T("err_not_saved"),
        HINT_DURATION.PERSIST,
      );
    }
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

  /** Remove every measurement matching the id and persist. */
  remove(id: string): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].id === id) this.list.splice(i, 1);
    }
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
