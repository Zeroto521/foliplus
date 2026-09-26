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
import { type Persisted, makePersisted } from "#common/storage.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see global.d.ts);
// bind the translator once, not per call site.
const T = createScopedTranslator(CONF);

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
  private readonly persistBinding: Persisted;

  constructor(map: L.Map, layerId: string) {
    this.map = map;
    this.layerId = layerId;
    // Write-through binding: the array is durable the moment a mutation lands,
    // so teardown flush is a no-op safety net. Failure surfaces through the
    // quota hint below rather than through the return value.
    this.persistBinding = makePersisted({
      save: () =>
        Storage.saveVersioned(CONST.STORAGE.KEY, {
          data: this.list,
          version: CONST.RECORD_VERSION,
          name: CONF.name,
          dataField: "items",
        }),
      onFlushError: () => {
        if (!this.warned) {
          this.warned = true;
          this.map.foliplus?.showHint?.(
            CONF.name,
            T("err_not_saved"),
            HINT_DURATION.PERSIST,
          );
        }
      },
    });
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

  /** Load measurements from localStorage via the shared versioned envelope
   *  reader. Tolerates the legacy bare-array shape and corrupt records. */
  load(): MeasureData[] {
    return (
      Storage.loadVersioned<MeasureData>(CONST.STORAGE.KEY, {
        name: CONF.name,
        dataField: "items",
      }) ?? []
    );
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
    this.persistBinding.schedule();
    this.emitCount();
  }

  /** Emit LAYER_ITEM_COUNT_CHANGE so LayerControl refreshes the count column
   *  without a write (e.g. after restore). */
  emitCount(): void {
    const events = ensureEvents(this.map);
    events.emit(EVENTS.LAYER_ITEM_COUNT_CHANGE, {
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

  /** Apply an arbitrary mutation to a measurement by id WITHOUT persisting.
   *  No-op if not found (defensive: a stale id from a torn-down handle must
   *  not crash — the caller already unbound the drag that would have called
   *  this, so a not-found is a no-op that costs one Map lookup).
   *
   *  Used by drag handlers that persist on a throttle: the mutation runs
   *  synchronously, the caller decides when to persist (onEnd, cancel, etc.).
   */
  mutate(id: string, fn: (m: MeasureData) => void): void {
    const m = this.list.find(x => x.id === id);
    if (!m) return;
    fn(m);
  }

  /** Apply a mutation AND persist. Equivalent to `mutate` + `persist`, but
   *  as one call site so the caller cannot forget the persist. No-op if
   *  not found (same reason as `mutate`). */
  mutateAndPersist(id: string, fn: (m: MeasureData) => void): void {
    const m = this.list.find(x => x.id === id);
    if (!m) return;
    fn(m);
    this.persist();
  }

  /** Remove all measurements and persist. */
  clear(): void {
    this.list.splice(0, this.list.length);
    this.persist();
  }
}

export { MeasureStore };
