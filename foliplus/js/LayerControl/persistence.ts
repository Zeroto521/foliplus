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
  private debouncedSaveNames: Debounced | undefined;
  private orderGetter: (() => string[]) | null = null;
  private hiddenGetter: (() => Set<string>) | null = null;
  private namesGetter: (() => Record<string, string>) | null = null;

  constructor(registry: LayerRegistry) {
    this.persistName = CONF.name;

    this.registry = registry;
  }

  // ── Order ──────────────────────────────────────────────────────────

  /** Load persisted order, dropping ids not currently registered. */
  loadOrder(): string[] | null {
    const data = Storage.load<string[]>(CONST.STORAGE.ORDER_KEY, this.persistName);
    if (!data || !Array.isArray(data)) return null;
    const layerSet = new Set(this.registry.layers.map(l => l.id));
    return data.filter(id => layerSet.has(id));
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
    if (Array.isArray(data)) return new Set(data);
    return new Set();
  }

  saveFoldedGroups(groups: Set<string>) {
    Storage.save(CONST.STORAGE.FOLD_KEY, Array.from(groups), this.persistName);
  }

  // ── Visibility (hidden ids) ────────────────────────────────────────

  loadHiddenIds(): Set<string> {
    const data = Storage.load<string[]>(CONST.STORAGE.VISIBILITY_KEY, this.persistName);
    if (!Array.isArray(data)) return new Set();
    const layerSet = new Set(this.registry.layers.map(l => l.id));
    return new Set(data.filter(id => typeof id === "string" && layerSet.has(id)));
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

  // ── Names (user-assigned display names) ──────────────────────────

  /**
   * Load user-assigned display names.
   *
   * Unlike the order and visibility loaders, this one deliberately does not
   * prune against the registry. This method runs once from {@link LayerUI.attachUI},
   * which is at the tail end of the LayerControl bundle — after `registerLayer`
   * has run for every component whose bundle already loaded, but before any
   * component that loads later gets to call `LayerAPI.createLayers` /
   * `createCanvas`. HeatmapControl and MeasureControl register their layers
   * in their own constructor, so a registry filter would drop their renames on
   * the very first attach and the user would see the component default name
   * after every refresh. `loadOrder` and `loadHiddenIds` keep the filter:
   * order is rebuilt on every save and hidden ids are re-applied on each late
   * registration, so a stale entry costs nothing there.
   */
  loadNames(): Record<string, string> {
    const data = Storage.load<Record<string, string>>(
      CONST.STORAGE.NAMES_KEY,
      this.persistName,
    );
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    // Value-level validation only. A rename keyed by an id that is not in the
    // registry yet is kept — it will be projected the moment that layer
    // registers. Stale ids are cleaned up in unregisterLayer, the only call
    // that knows a layer is gone for good.
    return Object.fromEntries(
      Object.entries(data).filter(([, name]) => typeof name === "string"),
    );
  }

  saveNames(namesGetter: () => Record<string, string>) {
    this.namesGetter = namesGetter;
    if (!this.debouncedSaveNames) {
      this.debouncedSaveNames = debounce(() => {
        if (!this.namesGetter) return;

        Storage.save(CONST.STORAGE.NAMES_KEY, this.namesGetter(), this.persistName);
      }, CONST.SAVE_ORDER_DEBOUNCE_MS);
    }

    this.debouncedSaveNames();
  }

  cancelSaveNames() {
    this.debouncedSaveNames?.cancel();
  }

  destroy() {
    this.debouncedSaveOrder?.cancel();

    this.debouncedSaveHiddenIds?.cancel();

    this.debouncedSaveNames?.cancel();
  }
}

export { LayerPersistence };
