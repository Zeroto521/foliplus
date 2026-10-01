import { GROUP, type LayerInfo, type LayerInfoRegistry } from "#core/layer/index.js";
import type { LayerPersistence } from "./persistence.js";

/** The order domain of LayerManager: the user-arranged id list and the
 *  one-way deleted-id set, plus the methods that load / snapshot / replay /
 *  prune them against the live registry.
 *
 *  Extracted wholesale from `manager.ts` so the manager keeps only the public
 *  forwards (`loadSavedOrder` / `saveOrder` / `replaySavedOrder` /
 *  `forgetSavedOrder`) and the ownership call-sites (`removedIds` gate and
 *  mark). Value and behaviour are unchanged: method bodies moved as-is. */
class SavedOrder {
  /** The order the user arranged: a snapshot of the live registry taken by the
   *  last user reorder (drag, moveLayerUp/Down, bringLayerToFront). Registration
   *  never writes it — a slot the author's code picked is not intent. `null`
   *  means the user never arranged an order, and replay falls back to the
   *  registration sequence. */
  savedOrder: string[] | null;
  /** Layer ids the user deleted, one-way: nothing removes an entry.
   *
   *  Consulted at construction, where it evicts the layer from the map, and at
   *  the registration entry point, where it keeps the id out of the registry
   *  — so nothing downstream ever has to check for it. Both run before the
   *  panel attaches, which is why this rides the manager's `order` instance
   *  rather than the UI.
   */
  removedIds: Set<string>;
  private registry: LayerInfoRegistry;
  /** Late-bound: the manager's `persistence` is a public field callers may
   *  replace (tests swap in a fresh debounce window), so every write goes
   *  through the getter rather than a captured instance. */
  private getPersistence: () => LayerPersistence;

  constructor(deps: {
    registry: LayerInfoRegistry;
    getPersistence: () => LayerPersistence;
    savedOrder: string[] | null;
    removedIds: Set<string>;
  }) {
    this.registry = deps.registry;
    this.getPersistence = deps.getPersistence;
    this.savedOrder = deps.savedOrder;
    this.removedIds = deps.removedIds;
  }

  loadSavedOrder() {
    const data = this.savedOrder;
    if (!data) return;
    const items = [...this.registry.layers];
    this.registry.replace(this.sortByStored(items, data));
  }

  /** Reorder `items` by `stored` rank; ids the record never ranked keep their
   *  live relative order at the bottom. */
  private sortByStored(items: LayerInfo[], stored: string[]): LayerInfo[] {
    const rank = new Map(stored.map((id, i) => [id, i]));
    const sorted = [...items];
    sorted.sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra === undefined) return rb === undefined ? 0 : 1;
      if (rb === undefined) return -1;
      return ra - rb;
    });
    return sorted;
  }

  /** Persist the current live order as a full snapshot — the user just
   *  reordered, so every layer present participates equally, the solid-color
   *  basemap included. Registration never reaches here: a slot picked by attach
   *  timing is not a user arrangement (see {@link SavedOrder.insertOverlayAt}).
   *
   *  Prune paths (deleteLayer / forgetSavedOrder) filter `savedOrder` and
   *  schedule the record directly instead of calling this, so a prune never
   *  turns a registration sequence into a snapshot.
   */
  saveOrder() {
    const order = this.registry.layers.map(l => l.id);
    this.savedOrder = order;
    this.getPersistence().schedule({ order: () => order });
  }

  /** Re-apply the stored order now that a layer exists.
   *
   *  Neither appearance point is the constructor: a component may register after
   *  the record was loaded, and the attach-time sweep drains registrations made
   *  before the UI existed. Without a replay the layer keeps the slot it was
   *  inserted into, which is not the position the user chose.
   *
   *  Ids with no stored position are left where they are -- appending them here
   *  would move a layer the user never arranged.
   */
  replaySavedOrder(id?: string) {
    const saved = this.savedOrder;
    if (!saved) return;
    const registry = this.registry;

    if (id !== undefined) {
      const layerInfo = registry.get(id);
      if (!layerInfo) return;
      const target = saved.indexOf(id);
      if (target === -1) return;
      this.placeBeforeSavedNeighbor(layerInfo, saved, target);
      return;
    }

    const items = [...registry.layers];
    // Ids with no stored rank stay at the bottom in live order.
    registry.replace(this.sortByStored(items, saved));
  }

  /** Move `layerInfo` just before the first saved-order neighbor that is
   *  registered. Neighbors that are not registered yet cannot be located, so
   *  this places it at the best spot the live registry can honour and a later
   *  replay refines it as the neighbors arrive. */
  private placeBeforeSavedNeighbor(
    layerInfo: LayerInfo,
    saved: string[],
    target: number,
  ): void {
    const registry = this.registry;
    const from = registry.indexOf(layerInfo);
    // `reorder`'s second argument is the index in the *final* order, so the
    // goal is expressed directly and no shift adjustment is applied.
    let goal: number;
    for (let i = target + 1; i < saved.length; i++) {
      const neighbor = registry.get(saved[i]);
      if (!neighbor) continue;
      const to = registry.indexOf(neighbor);
      // Removing `layerInfo` first shifts every later index down by one.
      goal = to - (from < to ? 1 : 0);
      if (from !== goal) registry.reorder(from, goal);
      return;
    }
    // Nothing below it in the saved order is registered yet, so it is the
    // rightmost of the layers that exist. That end is group-local: an overlay
    // that lands under a base layer breaks the overlay-before-base invariant,
    // so overlays fall back to the end of the overlay block; a base layer
    // falls back to the end of the base block (the registry end).
    goal =
      layerInfo.group === GROUP.BASE
        ? registry.layers.length - 1
        : registry.firstBaseIdx === -1
          ? registry.layers.length - 1
          : registry.firstBaseIdx - 1;
    if (from !== goal) registry.reorder(from, goal);
  }

  /** Where a new overlay enters the stack.
   *
   *  A layer without a stored position goes on top —a fresh layer has no user
   *  arrangement to honour, and top is what every other caller of `prepend`
   *  promises. With a stored position it takes the slot the user already chose.
   *  The placement is done here rather than left to a later sweep, because a
   *  registration that lands before the UI attaches never gets that sweep.
   */
  insertOverlayAt(layerInfo: LayerInfo): void {
    this.registry.prepend(layerInfo);
    this.placeAtSavedSlot(layerInfo);
  }

  /** Move a fresh layer to its stored slot when the record ranks it —prepend
   *  (overlay) and `baseInsert` (base) stay the defaults for a layer the user
   *  never arranged. Shared so base registrations replay a dragged slot the
   *  same way overlay registrations do. */
  placeAtSavedSlot(layerInfo: LayerInfo): void {
    const saved = this.savedOrder;
    if (!saved) return;
    const target = saved.indexOf(layerInfo.id);
    if (target === -1) return; // no stored position —keep the default insert
    this.placeBeforeSavedNeighbor(layerInfo, saved, target);
  }

  /**
   * Drop one id from the stored order without retiring the layer.
   *
   * The order half of `deleteLayer`, and the whole of a component clear:
   * after this call the id leaves `savedOrder` but stays registerable.
   * `deleteLayer` is the only caller that also records the id in
   * `removedIds` (a clear is not a delete — the user still owns the layer and
   * the next draw should land at the top of the stack, not back in the slot
   * they had arranged). Skipping this prune is what makes the next
   * `registerLayer` hit `insertOverlayAt`'s prepend branch rather than
   * `placeBeforeSavedNeighbor`'s return-to-slot path.
   *
   * `saveOrder` is NOT delegated: it is a full live snapshot reserved for
   * user reorders, while this is a prune. The filtered record is scheduled
   * directly so neighbors keep their rank and no snapshot is born from a
   * registration sequence.
   *
   * @param id - The layer ID whose stored position is being dropped.
   * @returns true if the id was in the stored order and got removed, false
   *   otherwise (nothing to forget). Callers treat false as a no-op, not an
   *   error —an id that was never registered has nothing to forget.
   */
  forgetSavedOrder(id: string): boolean {
    const saved = this.savedOrder;
    if (!saved || !saved.includes(id)) return false;
    this.savedOrder = saved.filter(other => other !== id);
    this.getPersistence().schedule({ order: () => this.savedOrder! });
    return true;
  }
}

export { SavedOrder };
