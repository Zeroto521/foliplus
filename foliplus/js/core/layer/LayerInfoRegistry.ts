// core/LayerInfoRegistry — ordered layer data model (list + id index + read-only view).
// Pure data, no DOM / CONFIG dependency. The LayerController orchestrates mutations.
import { createLogger } from "#common/log.js";
import { safeSVG } from "#common/sanitize.js";
import { GROUP } from "./const.js";
import type { LayerInfo, LayerKind, RegisterLayerOpts } from "./type.js";
import { deriveLayerKind, findLayer } from "./util.js";

// Mutating methods blocked on the read-only view.
const log = createLogger("LayerInfoRegistry");

/** Reject a position the array mutators cannot honour. `max` is inclusive:
 *  `insertAt` may append at `items.length`, `reorder` may not. Without this
 *  the splice coerces (`"1"`, `2.5`, `NaN`) or writes past the end, and the
 *  ordering backstop would be the thing corrupting the order. */
const assertIndex = (method: string, idx: number, max: number): void => {
  if (!Number.isInteger(idx) || idx < 0 || idx > max) {
    throw new Error(log.msg(`${method}: index ${String(idx)} is outside 0..${max}`));
  }
};

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

/** Derive `kind` at the registration edge — the single place in the codebase
 *  where a layer's kind is derived. `LayerController.surfaceFor` forwards the
 *  result to `LayerSurface`, which never re-derives it, so the registry and
 *  the surface cannot disagree about what a layer is. */
const kindFor = (opts: RegisterLayerOpts, layer: L.Layer | null): LayerKind =>
  deriveLayerKind({
    kind: opts.kind,
    color: opts.color,
    custom: opts.custom,
    canvas: Boolean(opts.canvas),
    layer,
  });

/** Build the carrier projection — the single write entry for where a layer's
 *  paint lives. `carrier` and the flat `layer` / `canvas` / `color` fields are
 *  stamped together here and never touched again, so the flat fields are read-only
 *  snapshots of this projection rather than a second, driftable source. Explicit
 *  no-carrier shapes (canvas-only / color / custom) fill the matching slot;
 *  `layer` stays null when there is no Leaflet layer. */
const carrierFor = (
  layer: L.Layer | null,
  canvas: HTMLCanvasElement | null,
  color: string | null,
  custom: unknown,
): LayerInfo["carrier"] => ({
  layer,
  canvas,
  element: color != null ? canvas : null,
  custom,
});

/**
 * Ordered layer info list with O(1) id index.
 *
 * **Public API (read-only, safe for external callers):**
 *   `size` / `at(i)` / `get(id)` / `has(id)` / `indexOfId(id)` / `firstBaseIdx`
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
class LayerInfoRegistry {
  /** Ordered entries. Direct mutation is unsupported: it desynchronizes
   *  `byId` and the id → position map. Go through the methods below; a
   *  caller that injects corruption must run a structural method (or
   *  `upsert`) before trusting `indexOfId` again. */
  items: LayerInfo[];
  byId: Map<string, LayerInfo>;
  /** id → live array position. Maintained by every structural mutator so the
   *  drag hot path resolves a row without an O(N) scan per event. */
  private indexById: Map<string, number>;
  _firstBaseIdx: number;
  view: LayerInfo[];

  constructor(data: LayerInfo[] = [], map?: L.Map) {
    this.items = data.map(l => this.createLayerInfo(l, undefined, map));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.indexById = new Map();
    this.reindex();
    this._firstBaseIdx = -1;
    this.refreshFirstBaseIdx();
    this.view = this.createReadonlyView();
  }

  /**
   * Create a layer info object with all fields populated.
   *
   * @param {RegisterLayerOpts} opts - Raw options from registerLayer().
   * @param {LayerInfo} [existingLi] - Existing layer info for re-registration.
   * @param {L.Map} [map] - Leaflet map. If provided, resolves `layer` from
   *   the map/window globals when `opts.layer` is absent.
   * @returns {LayerInfo} A complete layerInfo object.
   */
  createLayerInfo(
    opts: RegisterLayerOpts,
    existingLi?: LayerInfo,
    map?: L.Map,
  ): LayerInfo {
    // Resolve-once at registration (target: no `layer: null` lazy residue on
    // this path). A later `layerInfo.layer ?? findLayer` is the documented
    // late-binding fallback for folium's script-stream order only.
    const layer =
      opts.layer ??
      (map && opts.id ? findLayer(map, opts.id) : null) ??
      existingLi?.layer ??
      null;
    const canvas = opts.canvas ?? existingLi?.canvas ?? null;
    const color = opts.color ?? existingLi?.color ?? null;
    const custom = opts.custom ?? existingLi?.carrier?.custom;
    // Author-declared base: folium's `TileLayer(opacity=0.7)` lands on
    // `layer.options.opacity` without surfacing as `opts.opacity`, so a bare
    // `?? 1` snapshot would print 100% in the panel while the map renders
    // 70%. Same read as `authorOpacityBaseOf` (LayerControl/ui/apply.ts),
    // but a different capture discipline — that one is a per-layer WeakMap
    // frozen on first write, this one is a one-shot snapshot at registration;
    // they share only the read site, not the caching strategy. `opacity` is
    // not on the base `L.LayerOptions` type (it lives on GridLayer /
    // TileLayer / ImageOverlay), so the cast matches the apply.ts read.
    const authorOpts = layer?.options as { opacity?: unknown } | undefined;
    const authorOpacity =
      opts.opacity ??
      existingLi?.opacity ??
      (typeof authorOpts?.opacity === "number" ? authorOpts.opacity : 1);
    return {
      // A re-registration's caller name is the provider's own metadata, which
      // resets `name` and would clobber a user rename on the next render or
      // reload. The caller's explicit name only applies to a fresh id; an
      // existing layer keeps its current name (it is the registry's single
      // source of truth for what the user last saw).
      name: existingLi ? existingLi.name : (opts.name ?? opts.id),
      id: opts.id,
      opacity: authorOpacity,
      onOpacity: opts.onOpacity ?? existingLi?.onOpacity ?? null,
      opacityBake: opts.opacityBake ?? existingLi?.opacityBake ?? "redraw",
      group: opts.group ?? existingLi?.group ?? GROUP.OVERLAY,
      // Carried, never normalised: a caller that declared nothing leaves it
      // absent, and the seed sites apply folium's `true` default. Normalising
      // here would make every reader's `?? true` dead code — and would invent
      // a value for the callers that never spoke.
      show: opts.show ?? existingLi?.show,
      paneName: opts.paneName ?? existingLi?.paneName ?? null,
      paneSpecs: opts.paneSpecs ?? existingLi?.paneSpecs ?? [],
      // The only externally supplied HTML in the layer model: callers of
      // LayerAPI.registerLayer / createLayers may pass arbitrary markup, and
      // it lands in an innerHTML sink on the type-icon column. Clean it once,
      // here, so all three sinks share one value and a re-registration cannot
      // re-inject a payload the first pass rejected.
      iconSvg:
        opts.iconSvg != null
          ? safeSVG(opts.iconSvg) || null
          : (existingLi?.iconSvg ?? null),
      type: null,
      layer,
      kind: kindFor(opts, layer),
      carrier: carrierFor(layer, canvas, color, custom),
      canvas,
      color,
      featureCountProvider:
        opts.featureCountProvider ?? existingLi?.featureCountProvider ?? null,
      styleProvider: opts.styleProvider ?? existingLi?.styleProvider ?? null,
      styleSetters: opts.styleSetters ?? existingLi?.styleSetters ?? null,
      filterProvider: opts.filterProvider ?? existingLi?.filterProvider ?? null,
      filterSetter: opts.filterSetter ?? existingLi?.filterSetter ?? null,
      styleDefaultsProvider:
        opts.styleDefaultsProvider ?? existingLi?.styleDefaultsProvider ?? null,
      getBounds: opts.getBounds ?? existingLi?.getBounds ?? null,
      // Static caller-supplied metadata for the attributes panel. `??` (not
      // a spread) so a re-registration leaves the previous values in place —
      // the provider does not necessarily resend provenance on every call,
      // and clearing it on a silent refresh would lose it.
      source: opts.source ?? existingLi?.source ?? null,
      updatedAt: opts.updatedAt ?? existingLi?.updatedAt ?? null,
      meta: opts.meta ?? existingLi?.meta ?? null,
      metaProvider: opts.metaProvider ?? existingLi?.metaProvider ?? null,
      // Registration time: set once on first registration, never rewritten by a
      // provider re-registration.
      registeredAt: existingLi?.registeredAt ?? Date.now(),
    };
  }

  /** Recompute the cached first-base-layer index. */
  refreshFirstBaseIdx() {
    this._firstBaseIdx = this.items.findIndex(l => Boolean(l.group === GROUP.BASE));
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

  /** Stamp `updatedAt` to now — runtime mutations (heatmap field, measure
   *  edits) that do not re-register the layer still refresh the attrs panel. */
  touch(id: string): boolean {
    const layerInfo = this.byId.get(id);
    if (!layerInfo) return false;
    layerInfo.updatedAt = Date.now();
    return true;
  }

  has(id: string) {
    return this.byId.has(id);
  }

  indexOf(layerInfo: LayerInfo) {
    return this.items.indexOf(layerInfo);
  }

  /** Live array position of an id, or -1. Identity still belongs to `at()`:
   *  an id that now names a replacement resolves to a position, not to the
   *  entry a gesture armed with. */
  indexOfId(id: string): number {
    return this.indexById.get(id) ?? -1;
  }

  /** Rebuild the id → position map after a mutation that shifted indices. */
  private reindex(): void {
    this.indexById = new Map();
    for (let i = 0; i < this.items.length; i++) {
      this.indexById.set(this.items[i].id, i);
    }
  }

  /** First position the base block may occupy. With no base yet the block is
   *  empty and starts at the end, so the only legal base insertion is an
   *  append — never in front of the overlay block. */
  private baseBlockStart(): number {
    return this._firstBaseIdx === -1 ? this.items.length : this._firstBaseIdx;
  }

  /** Reject an id that is already registered. `prepend` / `insertAt` are
   *  insertion paths; an update belongs to `upsert`, and a duplicate here
   *  would put two list entries behind one `byId` slot. */
  private assertNewId(method: string, id: string): void {
    if (this.byId.has(id)) {
      throw new Error(
        log.msg(`${method}: "${id}" is already registered — update through upsert`),
      );
    }
  }

  /** Enforce the overlay-before-base partition at the write edge. `idx` is
   *  the insertion position in `0..items.length`; a base may land at or after
   *  the base block's start, an overlay only before it. */
  private assertPlacement(method: string, layerInfo: LayerInfo, idx: number): void {
    const firstBase = this.baseBlockStart();
    const valid = layerInfo.group === GROUP.BASE ? idx >= firstBase : idx <= firstBase;
    if (!valid) {
      throw new Error(
        log.msg(
          `${method}: cannot insert ${layerInfo.group} layer "${layerInfo.id}" at ` +
            `${idx} — the base block starts at ${firstBase}`,
        ),
      );
    }
  }

  /** Iterate in order (keeps `for...of` and spread working). */
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }

  /** Insert or update in place — never reorders an existing layer, and
   *  refuses to change one's group: an in-place swap keeps the slot, so a
   *  role change would strand the entry in the wrong block with a stale
   *  boundary. A NEW entry enters through the same placement gate as
   *  `insertAt` (overlays before the base block, bases appended), so upsert
   *  cannot be the second structural write that bypasses the partition. The
   *  registry enforces this itself, not through its callers — the
   *  controller's friendly gate is the first line, this is the backstop. */
  upsert(layerInfo: LayerInfo): LayerInfo {
    const existing = this.byId.get(layerInfo.id);
    if (!existing) {
      // A new entry enters at its block's edge: push() would let an overlay
      // land after the base block when bases already exist. `insertAt` owns
      // the placement gate and the derived-map rebuild.
      this.insertAt(
        layerInfo,
        layerInfo.group === GROUP.BASE ? this.items.length : this.baseBlockStart(),
      );
      return layerInfo;
    }
    if (existing.group !== layerInfo.group) {
      throw new Error(
        log.msg(
          `upsert: cannot change "${layerInfo.id}" from ${existing.group} to ` +
            `${layerInfo.group} in place — its group is its role for the id's lifetime`,
        ),
      );
    }
    const idx = this.items.indexOf(existing);
    if (idx === -1) {
      // The id and the list disagree (a lost delete, a bad replace). Repair
      // the whole registry from the list — appending only this entry would
      // leave a stale `byId` / positions for every other mismatch behind.
      this.items.push(layerInfo);
      this.byId = new Map(this.items.map(l => [l.id, l]));
      this.reindex();
      this.refreshFirstBaseIdx();
      return layerInfo;
    }
    // An in-place swap keeps the slot and cannot change the group (the gate
    // above), so neither the position nor `firstBaseIdx` can move.
    this.items[idx] = layerInfo;
    this.byId.set(layerInfo.id, layerInfo);
    return layerInfo;
  }

  /** Insert at the front (used for new overlay layers). A base layer is
   *  refused: index 0 lives inside the overlay block, and letting one land
   *  there would break the partition this class exists to keep. */
  prepend(layerInfo: LayerInfo): LayerInfo {
    this.assertNewId("prepend", layerInfo.id);
    if (layerInfo.group === GROUP.BASE) {
      throw new Error(
        log.msg(
          `prepend: "${layerInfo.id}" is a base layer — index 0 lives in the overlay block`,
        ),
      );
    }
    this.items.unshift(layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.reindex();
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  /** Insert before the given index (used for new base layers). `idx` may be
   *  `items.length` (append); anything else is refused by `assertIndex`.
   *  The placement gate keeps the overlay/base partition intact, and an id
   *  already in the registry is refused — updates belong to `upsert`. */
  insertAt(layerInfo: LayerInfo, idx: number): LayerInfo {
    this.assertNewId("insertAt", layerInfo.id);
    assertIndex("insertAt", idx, this.items.length);
    this.assertPlacement("insertAt", layerInfo, idx);
    this.items.splice(idx, 0, layerInfo);
    this.byId.set(layerInfo.id, layerInfo);
    this.reindex();
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  remove(id: string): LayerInfo | null {
    const layerInfo = this.byId.get(id);
    if (!layerInfo) return null;
    const idx = this.items.indexOf(layerInfo);
    if (idx !== -1) this.items.splice(idx, 1);
    this.byId.delete(id);
    this.reindex();
    this.refreshFirstBaseIdx();
    return layerInfo;
  }

  /** Move an existing layer to index 0 (bring to front). Refuses a base
   *  layer: index 0 lives inside the overlay block, and the partition is
   *  the registry's own invariant, not its callers' responsibility. */
  moveToFront(id: string): LayerInfo | null {
    const layerInfo = this.byId.get(id);
    if (!layerInfo) return null;
    const idx = this.items.indexOf(layerInfo);
    if (idx <= 0) return layerInfo;
    if (layerInfo.group === GROUP.BASE) {
      throw new Error(
        log.msg(
          `moveToFront: "${id}" is a base layer — it cannot cross the overlay/base boundary`,
        ),
      );
    }
    this.items.splice(idx, 1);
    this.items.unshift(layerInfo);
    this.reindex();
    return layerInfo;
  }

  /** Swap order of two positions (drag-and-drop). Both positions must sit
   *  on the same side of the overlay/base boundary — the public reorder
   *  entries gate with `canReorderBetween`, and this is the backstop that
   *  keeps the partition invariant when a caller forgets. */
  reorder(fromIdx: number, toIdx: number) {
    assertIndex("reorder(fromIdx)", fromIdx, this.items.length - 1);
    assertIndex("reorder(toIdx)", toIdx, this.items.length - 1);
    const firstBase = this._firstBaseIdx;
    const side = (i: number): number => (firstBase !== -1 && i >= firstBase ? 1 : 0);
    if (side(fromIdx) !== side(toIdx)) {
      throw new Error(
        log.msg(
          `reorder(${fromIdx} → ${toIdx}): cannot cross the overlay/base boundary ` +
            `(firstBaseIdx=${firstBase})`,
        ),
      );
    }
    const [moved] = this.items.splice(fromIdx, 1);
    this.items.splice(toIdx, 0, moved);
    this.reindex();
    this.refreshFirstBaseIdx();
  }

  /** Rebuild both list and index from a new ordered array. */
  replace(newList: LayerInfo[]) {
    this.items.splice(0, this.items.length, ...newList);
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.reindex();
    this.refreshFirstBaseIdx();
  }

  clear() {
    this.items.splice(0, this.items.length);
    this.byId.clear();
    this.indexById.clear();
    this.refreshFirstBaseIdx();
  }

  /** Reorder so all overlays come before all base layers. */
  normalizeGroups() {
    const overlays = [];
    const bases = [];
    for (const layerInfo of this.items) {
      if (layerInfo?.group === GROUP.BASE) bases.push(layerInfo);
      else overlays.push(layerInfo);
    }
    this.items.splice(0, this.items.length, ...overlays.concat(bases));
    this.byId = new Map(this.items.map(l => [l.id, l]));
    this.reindex();
    this.refreshFirstBaseIdx();
  }

  /**
   * Check whether a layer at fromIdx can be reordered to toIdx.
   * Only same-group (base ↔ base or overlay ↔ overlay) reordering is allowed. */
  canReorderBetween(fromIdx: number, toIdx: number): boolean {
    if (fromIdx == null || toIdx == null) return false;
    if (fromIdx < 0 || toIdx < 0) return false;
    if (fromIdx >= this.items.length || toIdx >= this.items.length) return false;
    const from = this.items[fromIdx];
    const to = this.items[toIdx];
    if (!from || !to) return false;
    if (from.group !== to.group) return false;

    const firstBaseIdx = this._firstBaseIdx;
    const hasBase = firstBaseIdx !== -1;

    if (from.group !== GROUP.BASE) {
      const overlayEnd = hasBase ? firstBaseIdx - 1 : this.items.length - 1;
      return fromIdx <= overlayEnd && toIdx <= overlayEnd;
    }
    return hasBase && fromIdx >= firstBaseIdx && toIdx >= firstBaseIdx;
  }
}

export { LayerInfoRegistry };
