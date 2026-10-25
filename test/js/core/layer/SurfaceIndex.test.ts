import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerSurface } from "#foliplus/core/layer/LayerSurface.js";
import { SurfaceIndex } from "#foliplus/core/layer/SurfaceIndex.js";

let count = 0;
beforeEach(() => {
  count = 0;
  vi.clearAllMocks();
  window.L.stamp = vi.fn(obj => obj.__id ?? (obj.__id = ++count));
});

const makeLayer = (): L.Layer => ({}) as unknown as L.Layer;
/** Only the two fields the index reads. The real LayerSurface carries the
 *  pane/renderer face; the pair semantics are what this suite pins. */
const makeSurface = (id: string, layer: L.Layer | null): LayerSurface =>
  ({ id, layer }) as unknown as LayerSurface;

describe("SurfaceIndex", () => {
  it("books both directions and exposes the id/registration order", () => {
    const index = new SurfaceIndex();
    const layer = makeLayer();
    const withLayer = makeSurface("a", layer);
    const declarationOnly = makeSurface("b", null);

    index.register(withLayer);
    index.register(declarationOnly);

    expect(index.get("a")).toBe(withLayer);
    expect(index.has("a")).toBe(true);
    expect(index.has("missing")).toBe(false);
    expect(index.size).toBe(2);
    expect(Array.from(index.values())).toEqual([withLayer, declarationOnly]);
    expect(Array.from(index.entries())).toEqual([
      ["a", withLayer],
      ["b", declarationOnly],
    ]);
    expect(index.getByLayer(layer)).toBe(withLayer);
    expect(index.getByStamp(window.L.stamp(layer))).toBe(withLayer);
    // A declaration-derived surface (canvas / color, layer === null) has no
    // reverse edge to leak.
    expect(index.getByLayer(makeLayer())).toBeUndefined();
    index.assertConsistent(new Set(["a", "b"]));
  });

  it("drops the superseded layer's reverse edge on a same-id replacement", () => {
    const index = new SurfaceIndex();
    const first = makeLayer();
    const second = makeLayer();
    const stale = makeSurface("a", first);
    const fresh = makeSurface("a", second);

    index.register(stale);
    index.register(fresh);

    expect(index.size).toBe(1);
    expect(index.get("a")).toBe(fresh);
    expect(index.getByLayer(first)).toBeUndefined();
    expect(index.getByLayer(second)).toBe(fresh);
    index.assertConsistent(new Set(["a"]));
  });

  it("drops the old edge when the replacement has no layer", () => {
    const index = new SurfaceIndex();
    const oldLayer = makeLayer();
    index.register(makeSurface("a", oldLayer));

    index.register(makeSurface("a", null));

    expect(index.getByLayer(oldLayer)).toBeUndefined();
    expect(index.size).toBe(1);
    index.assertConsistent(new Set(["a"]));
  });

  it("delete drops both directions and returns the surface", () => {
    const index = new SurfaceIndex();
    const layer = makeLayer();
    const surface = makeSurface("a", layer);
    index.register(surface);

    expect(index.delete("a")).toBe(surface);
    expect(index.get("a")).toBeUndefined();
    expect(index.getByLayer(layer)).toBeUndefined();
    expect(index.size).toBe(0);
    // Unknown ids answer undefined (the never-materialized teardown path).
    expect(index.delete("a")).toBeUndefined();
  });

  it("deleteByLayer drops only the reverse edge for a repair", () => {
    const index = new SurfaceIndex();
    const layer = makeLayer();
    const surface = makeSurface("a", layer);
    index.register(surface);

    index.deleteByLayer(layer);

    // Forward row survives on purpose: callers reach here when the surface
    // info is still needed for the teardown itself.
    expect(index.get("a")).toBe(surface);
    expect(index.getByLayer(layer)).toBeUndefined();
    expect(() => index.assertConsistent(new Set(["a"]))).toThrow(
      /missing reverse edge for "a"/,
    );
    index.delete("a");
    index.assertConsistent(new Set());
  });

  it("deleteByStamp drops the reverse edge by resolved stamp", () => {
    const index = new SurfaceIndex();
    const layer = makeLayer();
    index.register(makeSurface("a", layer));
    index.deleteByStamp(window.L.stamp(layer));

    expect(index.getByLayer(layer)).toBeUndefined();
    expect(index.get("a")).toBeDefined();
  });

  it("clear empties both directions", () => {
    const index = new SurfaceIndex();
    const layer = makeLayer();
    index.register(makeSurface("a", layer));
    index.register(makeSurface("b", null));

    index.clear();

    expect(index.size).toBe(0);
    expect(Array.from(index.values())).toEqual([]);
    expect(index.getByLayer(layer)).toBeUndefined();
    index.assertConsistent(new Set());
  });

  describe("assertConsistent", () => {
    it("passes for an empty index and for a coherent one", () => {
      const empty = new SurfaceIndex();
      expect(() => empty.assertConsistent(new Set())).not.toThrow();

      const index = new SurfaceIndex();
      index.register(makeSurface("a", makeLayer()));
      index.register(makeSurface("b", null));
      expect(() => index.assertConsistent(new Set(["a", "b"]))).not.toThrow();
    });

    it("names a dangling forward surface", () => {
      const index = new SurfaceIndex();
      index.register(makeSurface("a", null));
      // Fresh Set: the id is registered but the registry never got an entry.
      expect(() => index.assertConsistent(new Set())).toThrow(/dangling surface "a"/);
    });

    it("names an id that maps to a different surface", () => {
      const index = new SurfaceIndex();
      index.register(makeSurface("a", null));
      index.byId.set("b", index.get("a")!);

      expect(() => index.assertConsistent(new Set(["a", "b"]))).toThrow(
        /surface mismatch: id "b" maps to surface "a"/,
      );
    });

    it("names a dangling reverse edge", () => {
      const index = new SurfaceIndex();
      const ghost = makeSurface("ghost", makeLayer());
      const byStamp = (index as unknown as { byStamp: Map<number, LayerSurface> })
        .byStamp;
      byStamp.set(999, ghost);

      expect(() => index.assertConsistent(new Set())).toThrow(
        /dangling reverse edge \(stamp 999\) for "ghost"/,
      );
    });

    it("names a reverse edge whose stamp is not the surface layer's", () => {
      const index = new SurfaceIndex();
      const layer = makeLayer();
      const other = makeLayer();
      const surface = makeSurface("a", layer);
      index.register(surface);
      (index as unknown as { byStamp: Map<number, LayerSurface> }).byStamp.set(
        window.L.stamp(other),
        surface,
      );

      expect(() => index.assertConsistent(new Set(["a"]))).toThrow(
        /reverse edge stamp \d+ does not name "a"/,
      );
    });
  });
});
