import type { LayerRegistry } from "#core/layer/index.js";
import { type Debounced, debounce } from "#common/debounce.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

/** One persisted dimension: its key and the lazy getter its debounced write
 *  reads. Fold state saves immediately, so it has no timer and no getter. */
type Dimension = "order" | "hidden" | "names";

/** What {@link LayerPersistence.load} returns — every dimension, or null / an
 *  empty container where storage had none. */
type PersistedState = {
  order: string[] | null;
  foldedGroups: Set<string>;
  hiddenIds: Set<string>;
  names: Record<string, string>;
};

/**
 * Single entry point for all LayerControl persistence (localStorage).
 *
 * Four dimensions persist independently -- order, fold, visibility, names --
 * so each debounced write coalesces on its own timer without interfering with
 * the others, and a corrupt read of one dimension doesn't cascade into the
 * rest.
 *
 * Reads go through {@link load} and writes through {@link write}, so a new
 * dimension is added in one place on each side instead of being sprinkled over
 * the call sites. `flushAll` is what makes that safe at teardown: it is a
 * single call rather than a per-dimension list, so adding a dimension cannot
 * silently lose its last write.
 *
 * Storage key pattern: <prefix>_<mapContainerId> -- map-scoped so multi-map
 * pages keep their per-map state separate. Keys live in const.ts so they
 * can be asserted by tests without importing this module.
 */
class LayerPersistence {
  private readonly persistName: string;
  private readonly registry: LayerRegistry;

  private readonly timers: Record<Dimension, Debounced | undefined> = {
    order: undefined,
    hidden: undefined,
    names: undefined,
  };
  private readonly getters: Record<Dimension, (() => unknown) | null> = {
    order: null,
    hidden: null,
    names: null,
  };

  constructor(registry: LayerRegistry) {
    this.persistName = CONF.name;
    this.registry = registry;
  }

  // ── Read ───────────────────────────────────────────────────────────

  /**
   * Load every dimension. The only read entry point, so a new dimension
   * cannot be missed on load and nothing else calls `Storage.load`.
   *
   * Only order is filtered against the registry: it is rebuilt on every save,
   * so an unknown id is skipped when the order is applied. Hidden ids and
   * names deliberately are not -- this runs from `LayerUI.attachUI`, which
   * loads before HeatmapControl and MeasureControl register in their own
   * constructor, so filtering here would drop their entries on the very first
   * attach and show the default name or re-add the layer after every refresh.
   * Stale ids are pruned elsewhere: names in `unregisterLayer`, the only call
   * that knows a layer is gone for good; hidden ids in
   * `LayerUI.applyUserState`, after the late registrations have landed.
   */
  load(): PersistedState {
    const ids = this.registry.layers.map(l => l.id);
    const strings = (key: string) => {
      const data = Storage.load<unknown[]>(key, this.persistName);
      return Array.isArray(data) && data.every(id => typeof id === "string")
        ? (data as string[])
        : null;
    };
    const inRegistry = (arr: string[]) => arr.filter(id => ids.includes(id));

    const order = strings(CONST.STORAGE.ORDER_KEY);
    const hidden = strings(CONST.STORAGE.VISIBILITY_KEY);
    const folded = strings(CONST.STORAGE.FOLD_KEY);
    const namesData = Storage.load<Record<string, unknown>>(
      CONST.STORAGE.NAMES_KEY,
      this.persistName,
    );
    const nameEntries = Object.entries(namesData ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    const names: Record<string, string> = Object.fromEntries(nameEntries);

    return {
      order: order ? inRegistry(order) : null,
      foldedGroups: new Set(folded ?? []),
      hiddenIds: new Set(hidden ?? []),
      names,
    };
  }

  // ── Write ──────────────────────────────────────────────────────────

  /**
   * Persist one dimension on its own debounce timer. Every dimension funnels
   * through here, which is what makes `flushAll` a single call at teardown
   * instead of a per-dimension list. The getter is captured lazily so the
   * debounced callback reads the latest state after a drag / toggleAll /
   * rename batch.
   */
  private write(key: string, dimension: Dimension, getter: () => unknown) {
    this.getters[dimension] = getter;
    if (!this.timers[dimension]) {
      this.timers[dimension] = debounce(() => {
        const get = this.getters[dimension];
        if (!get) return;
        Storage.save(key, this.serialize(dimension, get()), this.persistName);
      }, CONST.SAVE_ORDER_DEBOUNCE_MS);
    }
    this.timers[dimension]();
  }

  /** Persist the current layer order. */
  saveOrder(orderGetter: () => string[]) {
    this.write(CONST.STORAGE.ORDER_KEY, "order", orderGetter);
  }

  /** Persist the current hidden id set. */
  saveHiddenIds(hiddenGetter: () => Set<string>) {
    this.write(CONST.STORAGE.VISIBILITY_KEY, "hidden", hiddenGetter);
  }

  /** Persist the current user-assigned names. */
  saveNames(namesGetter: () => Record<string, string>) {
    this.write(CONST.STORAGE.NAMES_KEY, "names", namesGetter);
  }

  /** Persist fold state immediately -- it toggles rarely, so no debounce. */
  saveFoldedGroups(groups: Set<string>) {
    Storage.save(CONST.STORAGE.FOLD_KEY, Array.from(groups), this.persistName);
  }

  /**
   * Write every pending debounced dimension. Teardown calls this before the
   * timers are cleared -- the write is debounced at 100ms, wide enough for the
   * control to be removed before the timer fires, so flush must come first or
   * the last toggle / reorder is dropped.
   */
  flushAll() {
    for (const timer of Object.values(this.timers)) timer?.flush();
  }

  destroy() {
    // Flush first: cancel() clears the timer and would make a later flush a
    // no-op, so the write is never order-dependent on the caller.
    this.flushAll();
    for (const timer of Object.values(this.timers)) timer?.cancel();
  }

  /** A Set serializes as an array; everything else persists verbatim. */
  private serialize(dimension: Dimension, value: unknown): unknown {
    return dimension === "hidden" ? Array.from(value as Set<string>) : value;
  }
}

export { LayerPersistence };
export type { PersistedState };
