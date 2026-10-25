// core/SurfaceIndex — the two-way surface index.
// Responsibility: "which surface paints layer X" answered from either end —
// by layer id (the authoritative direction: registration / teardown / capability
// reads) and by the live layer's `L.stamp` (attribution from a layer). The two
// directions are written as ONE pair, so the reverse edge can never be a stale
// row behind the forward one. LayerController and LayerOrchestration used to
// maintain two Maps by hand at three write points; this class is that single
// write entry.
//
// No DOM, no Leaflet layer construction. `L.stamp` is a pure identity read
// (Leaflet assigns it), which is the only map-touch this index needs.
//
// TypeScript `private`, never an ES `#` field: component bundles are inlined
// into a Jinja2 template at render time (see PaneManager's header for the
// `{#` comment-tag failure this avoids).
import { createLogger } from "#common/log.js";
import type { LayerSurface } from "./LayerSurface.js";

const log = createLogger("SurfaceIndex");

class SurfaceIndex {
  /** id -> surface, the authoritative direction. Public as a READ-ONLY view:
   *  LayerController forwards it as its legacy `surfaces` field, and tests
   *  read it. Writes go through `register` / `delete` / `clear` so the stamp
   *  edge below is always updated with it. */
  readonly byId = new Map<string, LayerSurface>();
  /** L.stamp(layer) -> surface, for the lookups that start from a live layer
   *  rather than from a registry entry (attribution, export). One row per
   *  surface that has a layer; declaration-derived surfaces (canvas / color
   *  with `layer === null`) have no reverse edge. */
  private readonly byStamp = new Map<number, LayerSurface>();

  /** The surface painting `id`, when any. */
  get(id: string): LayerSurface | undefined {
    return this.byId.get(id);
  }

  /** Whether `id` currently has a surface. */
  has(id: string): boolean {
    return this.byId.has(id);
  }

  /** The surface keyed by a layer stamp, when any. */
  getByStamp(stamp: number): LayerSurface | undefined {
    return this.byStamp.get(stamp);
  }

  /** The surface painting a live layer, when any — the reverse direction's
   *  one read. */
  getByLayer(layer: L.Layer): LayerSurface | undefined {
    return this.byStamp.get(L.stamp(layer));
  }

  /** Book (or replace) `surface` under its id. A same-id replacement drops
   *  the previous surface's stamp edge first: a lookup by the superseded
   *  layer must not answer with a surface nobody paints into any more. */
  register(surface: LayerSurface): void {
    const previous = this.byId.get(surface.id);
    if (previous?.layer) this.byStamp.delete(L.stamp(previous.layer));
    this.byId.set(surface.id, surface);
    if (surface.layer) this.byStamp.set(L.stamp(surface.layer), surface);
  }

  /** Drop the surface registered for `id` (both directions) and return it so
   *  the caller tears its resources down. Unknown ids answer undefined — the
   *  teardown path for an id that never materialized. */
  delete(id: string): LayerSurface | undefined {
    const surface = this.byId.get(id);
    if (!surface) return undefined;
    this.byId.delete(id);
    if (surface.layer) this.byStamp.delete(L.stamp(surface.layer));
    return surface;
  }

  /** Drop the stamp edge for `layer` alone. Used by the teardown path when
   *  the caller already resolved the layer independently of the surface (and
   *  by tests simulating the lost-row repair). */
  deleteByLayer(layer: L.Layer): void {
    this.deleteByStamp(L.stamp(layer));
  }

  /** Drop one stamp edge by value — the teardown path already resolved the
   *  layer's stamp independently of the surface. */
  deleteByStamp(stamp: number): void {
    this.byStamp.delete(stamp);
  }

  /** Every surface in id-registration order. */
  values(): IterableIterator<LayerSurface> {
    return this.byId.values();
  }

  /** Every [id, surface] pair in registration order — the shape callers that
   *  announce per-id capabilities iterate. */
  entries(): IterableIterator<[string, LayerSurface]> {
    return this.byId.entries();
  }

  /** Number of indexed surfaces. */
  get size(): number {
    return this.byId.size;
  }

  /** Drop both directions — the controller's destroy step. */
  clear(): void {
    this.byId.clear();
    this.byStamp.clear();
  }

  /** Test/teardown guard: assert the two directions describe the same set and
   *  that no id survives outside `registryIds` (no dangling surface). A
   *  defect should be loud, not a silent stale row. */
  assertConsistent(registryIds: ReadonlySet<string>): void {
    for (const [id, surface] of this.byId) {
      if (surface.id !== id) {
        throw new Error(
          log.msg(`surface mismatch: id "${id}" maps to surface "${surface.id}"`),
        );
      }
      if (!registryIds.has(id)) {
        throw new Error(log.msg(`dangling surface "${id}": the registry has no entry`));
      }
      if (!surface.layer) continue;
      const stamp = L.stamp(surface.layer);
      if (this.byStamp.get(stamp) !== surface) {
        throw new Error(
          log.msg(`missing reverse edge for "${id}" (layer stamp ${stamp})`),
        );
      }
    }
    for (const [stamp, surface] of this.byStamp) {
      if (this.byId.get(surface.id) !== surface) {
        throw new Error(
          log.msg(`dangling reverse edge (stamp ${stamp}) for "${surface.id}"`),
        );
      }
      if (!surface.layer || L.stamp(surface.layer) !== stamp) {
        throw new Error(
          log.msg(`reverse edge stamp ${stamp} does not name "${surface.id}"`),
        );
      }
    }
  }
}

export { SurfaceIndex };
