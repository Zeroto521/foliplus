// core/LayerRegistry — ordered layer data model (list + id index + read-only view).
// Pure data, no DOM / CONF dependency. The LayerManager orchestrates mutations.
import { createLogger } from "#common/log.js";
import type { LayerInfo, RegisterLayerOpts } from "./type.js";
import { findLayer } from "./util.js";

// Mutating methods blocked on the read-only view.
const log = createLogger("LayerRegistry");

// Mutating methods blocked on the read-only view.
const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "reverse",
  "sort",
  "fill",
  "copyWithin",
]);

/**
 * Ordered layer info list with O(1) id index.
 *
 * **Public API (read-only, safe for external callers):**
 *   `size` / `at(i)` / `get(id)` / `has(id)` / `firstBaseIdx`
 *
 * **Internal (Manager only, not for external use):**
 *   `createLayerInfo` / `upsert` / `prepend` / `insertAt` / `remove`
 *   `moveToFront` / `reorder` / `replace` / `clear` / `normalizeGroups`
 *   `canReorderBetween` / `refreshFirstBaseIdx`
 *   `items` / `byId` / `view` / `layers`
 *
 * External callers must use the Manager API for mutations:
 *   `api.registerLayer({...})`   — insert/update
 *   `api.unregisterLayer(id)`    — remove
 *   `api.bringLayerToFront(id)`  — reorder
 */
class LayerRegistry {
  items: LayerInfo[];
  byId: Map<string, LayerInfo>;
  _firstBaseIdx: number;
  view: LayerInfo[];

  constructor(data: LayerInfo[] = [], map?: L.Map) {
    this.items = data.map(l => this.createLayerInfo(l, undefined, map));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this._firstBaseIdx = -1;
    this.refreshFirstBaseIdx();
    this.view = this.createReadonlyView();
  }

  /**
   * Create a layer info object with all fields populated.
   *
   * @param {Object} opts - Raw options from registerLayer().
   * @param {Object} [existingLi] - Existing layer info for re-registration.
   * @param {Object} [map] - Leaflet map. If provided, resolves `layer` from
   *   the map/window globals when `opts.layer` is absent.
   * @returns {Object} A complete layerInfo object.
   */
  createLayerInfo(
    opts: RegisterLayerOpts,
    existingLi?: LayerInfo,
    map?: L.Map,
  ): LayerInfo {
    return {
      // A re-registration's caller name is the provider's own metadata, which
      // resets `name` and would clobber a user rename on the next render or
      // reload. The caller's explicit name only applies to a fresh id; an
      // existing layer keeps its current name (it is the registry's single
      // source of truth for what the user last saw).
      name: existingLi ? existingLi.name : (opts.name ?? opts.id),
      id: opts.id,
      visible: opts.visible ?? existingLi?.visible ?? true,
      isBase: opts.isBase ?? existingLi?.isBase ?? false,
      paneName: opts.paneName ?? existingLi?.paneName ?? null,
      labelPane: opts.labelPane ?? existingLi?.labelPane ?? null,
      iconSvg: opts.iconSvg ?? existingLi?.iconSvg ?? null,
      type: null,
      layer:
        opts.layer ||
        (map && opts.id ? findLayer(map, opts.id) : null) ||
        existingLi?.layer ||
        null,
      canvas: opts.canvas ?? existingLi?.canvas ?? null,
      onToggle: opts.onToggle ?? existingLi?.onToggle ?? null,
      onZIndex: opts.onZIndex ?? existingLi?.onZIndex ?? null,
      featureCountProvider:
        opts.featureCountProvider ?? existingLi?.featureCountProvider ?? null,
      getBounds: opts.getBounds ?? existingLi?.getBounds ?? null,
    };
  }

  /** Recompute the cached first-base-layer index. */
  refreshFirstBaseIdx() {
    this._firstBaseIdx = this.items.findIndex(l => !!l.isBase);
  }

  /** Index of the first base layer, or -1 if none. */
  get firstBaseIdx() {
    return this._firstBaseIdx;
  }

  /** Create a read-only proxy over the internal array. */
  createReadonlyView() {
    return new Proxy(this.items, {
      set() {
        throw new TypeError(log.msg("layers is read-only, mutate via API"));
      },
      deleteProperty() {
        throw new TypeError(log.msg("cannot delete layers directly"));
      },
      defineProperty() {
        // Without this trap, Object.defineProperty(view, '0', {...}) forwarded
        // to the internal mutable array and bypassed the read-only guarantee.
        throw new TypeError(log.msg("cannot define properties on layers"));
      },
      get(target, prop, receiver) {
        if (typeof prop === "string" && MUTATING_METHODS.has(prop)) {
          throw new TypeError(log.msg(`read-only method "${String(prop)}" is blocked`));
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /** The ordered layers array (read-only view; mutate via methods). */
  get layers() {
    return this.view;
  }

  get size() {
    return this.items.length;
  }

  at(i: number) {
    return this.items[i];
  }

  get(id: string) {
    return this.byId.get(id);
  }

  has(id: string) {
    return this.byId.has(id);
  }

  indexOf(layerInfo: LayerInfo) {
    return this.items.indexOf(layerInfo);
  }

  /** Iterate in order (keeps `for...of` and spread working). */
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }

  /** Insert or update in place — never reorders an existing layer. */
  upsert(layerInfo: LayerInfo): LayerInfo {
    const existing = this.byId.get(layerInfo.id);
    if (existing) {
      const idx = this.items.indexOf(existing);
      this.items[idx] = layerInfo;
    } else {
      this.items.push(layerInfo);
      this.refreshFirstBaseIdx();
    }
    this.byId.set(layerInfo.id, layerInfo);
    return layerInfo;
  }

  /** Insert at the front (used for new overlay layers). */
  prepend(layerInfo: LayerInfo): LayerInfo {
    this.items.unshift(layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  /** Insert before the given index (used for new base layers). */
  insertAt(layerInfo: LayerInfo, idx: number): LayerInfo {
    this.items.splice(idx, 0, layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  remove(id: string): LayerInfo | null {
    const layerInfo = this.byId.get(id);
    if (!layerInfo) return null;
    const idx = this.items.indexOf(layerInfo);
    if (idx !== -1) this.items.splice(idx, 1);
    this.byId.delete(id);
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  /** Move an existing layer to index 0 (bring to front). */
  moveToFront(id: string): LayerInfo | null {
    const layerInfo = this.byId.get(id);
    if (!layerInfo) return null;
    const idx = this.items.indexOf(layerInfo);
    if (idx <= 0) return layerInfo;
    this.items.splice(idx, 1);
    this.items.unshift(layerInfo);
    return layerInfo;
  }

  /** Swap order of two positions (drag-and-drop). */
  reorder(fromIdx: number, toIdx: number) {
    const [moved] = this.items.splice(fromIdx, 1);
    this.items.splice(toIdx, 0, moved);
  }

  /** Rebuild both list and index from a new ordered array. */
  replace(newList: LayerInfo[]) {
    this.items.splice(0, this.items.length, ...newList);
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.refreshFirstBaseIdx();
  }

  clear() {
    this.items.splice(0, this.items.length);
    this.byId.clear();
    this.refreshFirstBaseIdx();
  }

  /** Reorder so all overlays come before all base layers. */
  normalizeGroups() {
    const overlays = [];
    const bases = [];
    for (const layerInfo of this.items) {
      if (layerInfo && layerInfo.isBase) bases.push(layerInfo);
      else overlays.push(layerInfo);
    }
    this.items.splice(0, this.items.length, ...overlays.concat(bases));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.refreshFirstBaseIdx();
  }

  /**
   * Check whether a layer at fromIdx can be reordered to toIdx.
   * Only same-group (base↔base or overlay↔overlay) reordering is allowed. */
  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    if (fromIdx == null || toIdx == null) return false;
    if (fromIdx < 0 || toIdx < 0) return false;
    if (fromIdx >= this.items.length || toIdx >= this.items.length) return false;
    const from = this.items[fromIdx];
    const to = this.items[toIdx];
    if (!from || !to) return false;
    if (!!from.isBase !== !!to.isBase) return false;

    const firstBaseIdx = this._firstBaseIdx;
    const hasBase = firstBaseIdx !== -1;

    if (!from.isBase) {
      const overlayEnd = hasBase ? firstBaseIdx - 1 : this.items.length - 1;
      return fromIdx <= overlayEnd && toIdx <= overlayEnd;
    }
    return hasBase && fromIdx >= firstBaseIdx && toIdx >= firstBaseIdx;
  }
}

export { LayerRegistry };
