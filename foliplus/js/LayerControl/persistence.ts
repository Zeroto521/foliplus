import type { LayerRegistry } from "#core/layer/index.js";
import { type Debounced, debounce } from "#common/debounce.js";
import * as Storage from "#common/storage.js";
import * as CONST from "./const.js";

// CONF is a free variable from the IIFE template wrapper (see BaseControl._get_template).

/**
 * Single entry point for all LayerControl persistence (localStorage).
 *
 * Three dimensions persist independently -- order, fold, visibility -- so
 * each can debounce its own write without interfering with the others, and
 * a corrupt read of one dimension doesn't cascade into the others. Adding a
 * new dimension is a one-line addition to STORAGE + a pair of methods here;
 * call sites never touch Storage directly.
 *
 * Storage key pattern: <prefix>_<mapContainerId> -- map-scoped so multi-map
 * pages keep their per-map state separate. Keys live in const.ts so they
 * can be asserted by tests without importing this module.
 */
class LayerPersistence {
  private readonly persistName: string;
  private readonly registry: LayerRegistry;
  private debouncedSaveOrder: Debounced | undefined;
  private debouncedSaveHiddenIds: Debounced | undefined;
  private orderGetter: (() => string[]) | null = null;
  private hiddenGetter: (() => Set<string>) | null = null;

  constructor(registry: LayerRegistry) {
    this.persistName = CONF.name;
    this.registry = registry;
  }

  // ── Order ──────────────────────────────────────────────────────────

  /** Load persisted order, dropping ids not currently registered. */
  loadOrder(): string[] | null {
    const data = Storage.load<string[]>(CONST.STORAGE.ORDER_KEY, this.persistName);
    if (!data || !Array.isArray(data)) {
      console.debug(`[${this.persistName}] No saved order found, using initial order`);
      return null;
    }
    const layerSet = new Set(this.registry.layers.map(l => l.id));
    const filtered = data.filter(id => layerSet.has(id));
    console.debug(
      `[${this.persistName}] Loaded order: ${filtered.length} id(s) restored`,
    );
    return filtered;
  }

  /**
   * Persist the current order. Getter is captured lazily so the debounced
   * callback reads the *latest* layer order after a drag/move batch.
   */
  saveOrder(orderGetter: () => string[]) {
    this.orderGetter = orderGetter;
    if (!this.debouncedSaveOrder) {
      this.debouncedSaveOrder = debounce(() => {
        if (!this.orderGetter) return;
        Storage.save(CONST.STORAGE.ORDER_KEY, this.orderGetter(), this.persistName);
      }, CONST.SAVE_ORDER_DEBOUNCE_MS);
    }
    this.debouncedSaveOrder();
  }

  cancelSaveOrder() {
    this.debouncedSaveOrder?.cancel();
  }

  // ── Fold state ─────────────────────────────────────────────────────

  loadFoldedGroups(): Set<string> {
    const data = Storage.load<string[]>(CONST.STORAGE.FOLD_KEY, this.persistName);
    if (Array.isArray(data)) {
      console.debug(`[${this.persistName}] Loaded fold state: ${data.length} group(s) restored`);
      return new Set(data);
    }
    console.debug(`[${this.persistName}] No saved fold state, using default open`);
    return new Set();
  }

  saveFoldedGroups(groups: Set<string>) {
    Storage.save(CONST.STORAGE.FOLD_KEY, Array.from(groups), this.persistName);
  }

  // ── Visibility (hidden ids) ────────────────────────────────────────

  loadHiddenIds(): Set<string> {
    const data = Storage.load<string[]>(CONST.STORAGE.VISIBILITY_KEY, this.persistName);
    if (Array.isArray(data)) {
      const ids = data.filter(id => typeof id === "string");
      console.debug(`[${this.persistName}] Loaded hidden ids: ${ids.length} id(s) restored`);
      return new Set(ids);
    }
    console.debug(`[${this.persistName}] No saved visibility state, all layers visible`);
    return new Set();
  }

  /**
   * Persist the current hidden id set. Getter is captured lazily so the
   * debounced callback reads the latest set after bulk updates (toggleAll,
   * stale-id prune).
   */
  saveHiddenIds(hiddenGetter: () => Set<string>) {
    this.hiddenGetter = hiddenGetter;
    if (!this.debouncedSaveHiddenIds) {
      this.debouncedSaveHiddenIds = debounce(() => {
        if (!this.hiddenGetter) return;
        Storage.save(
          CONST.STORAGE.VISIBILITY_KEY,
          Array.from(this.hiddenGetter()),
          this.persistName,
        );
      }, CONST.SAVE_ORDER_DEBOUNCE_MS);
    }
    this.debouncedSaveHiddenIds();
  }

  cancelSaveHiddenIds() {
    this.debouncedSaveHiddenIds?.cancel();
  }

  destroy() {
    this.debouncedSaveOrder?.cancel();
    this.debouncedSaveHiddenIds?.cancel();
  }
}

export { LayerPersistence };