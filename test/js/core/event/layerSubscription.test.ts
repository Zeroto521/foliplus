import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents, subscribeLayers } from "#foliplus/core/event/index.js";

// subscribeLayers is the "one layer set, one handler" convenience over the
// per-map EventBus: filter by ids or a predicate, merge everything that lands
// in the same animation frame into one delivery, and hand back an idempotent
// unsubscribe. The bus is not replaced — these tests read the bus's own
// listenerCount to prove the helper is a view over it.

type UnloadMap = {
  on: (event: string, fn: () => void) => void;
  off: (event: string, fn: () => void) => void;
  fireUnload: () => void;
};

const makeMap = (): UnloadMap => {
  const unload: Array<() => void> = [];
  return {
    on: (event, fn) => {
      if (event === "unload") unload.push(fn);
    },
    off: (event, fn) => {
      if (event !== "unload") return;
      const idx = unload.indexOf(fn);
      if (idx >= 0) unload.splice(idx, 1);
    },
    fireUnload: () => {
      for (const fn of [...unload]) fn();
    },
  };
};

const layerChange = (id: string, kind = "vector") => ({
  id,
  kind: kind as "vector",
});

/** Let the stubbed frame run (rAF is a 0ms timeout in these tests). */
const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 20));

describe("subscribeLayers", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delivers only the layers in the id set", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, ["a", "c"], handler);

    const bus = ensureEvents(map as never);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("b"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("c"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(
      handler.mock.calls[0][0].map((d: { payload: { id: string } }) => d.payload.id),
    ).toEqual(["a", "c"]);
  });

  it("filters through a predicate", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, payload => payload.kind === "tile", handler);

    const bus = ensureEvents(map as never);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("t", "tile"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(1);
    expect(handler.mock.calls[0][0][0].payload.id).toBe("t");
  });

  it("merges repeated events for one layer into one delivery of the latest payload", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, ["a"], handler);

    const bus = ensureEvents(map as never);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(1);
  });

  it("batches distinct layers changed in the same frame into one call", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, payload => payload.id !== "skip", handler);

    const bus = ensureEvents(map as never);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("b"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toHaveLength(2);
  });

  it("subscribes to every requested event and tags each delivery", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, ["a"], handler, {
      events: [EVENTS.LAYER_CHANGE, EVENTS.LAYER_INTENT_CHANGE],
    });

    const bus = ensureEvents(map as never);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    bus.emit(EVENTS.LAYER_INTENT_CHANGE, {
      ...layerChange("a"),
      intent: { visible: false },
    });
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    const batch = handler.mock.calls[0][0];
    expect(batch).toHaveLength(2);
    expect(batch.map((d: { event: string }) => d.event)).toEqual([
      EVENTS.LAYER_CHANGE,
      EVENTS.LAYER_INTENT_CHANGE,
    ]);
  });

  it("unsubscribes idempotently and drops the bus listeners", async () => {
    const map = makeMap();
    const handler = vi.fn();
    const stop = subscribeLayers(map as never, ["a"], handler);
    const bus = ensureEvents(map as never);
    expect(bus.listenerCount).toBe(1);

    stop();
    stop();
    expect(bus.listenerCount).toBe(0);

    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();
    expect(handler).not.toHaveBeenCalled();
  });

  it("cancels a frame that was already scheduled when unsubscribed", async () => {
    const map = makeMap();
    const handler = vi.fn();
    const stop = subscribeLayers(map as never, ["a"], handler);
    const bus = ensureEvents(map as never);

    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    stop();
    await nextFrame();
    expect(handler).not.toHaveBeenCalled();
  });

  it("stops delivering once the map unloads", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, ["a"], handler);
    const bus = ensureEvents(map as never);

    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();
    expect(handler).toHaveBeenCalledTimes(1);

    map.fireUnload();
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount).toBe(0);
  });

  it("works with a bare stub map that has no on/off hooks", async () => {
    const map = {} as never;
    const handler = vi.fn();
    const stop = subscribeLayers(map, ["a"], handler);

    const bus = ensureEvents(map);
    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    // No map.off on this carrier: teardown must still drop the bus listeners.
    stop();
    expect(bus.listenerCount).toBe(0);
  });

  it("a predicate can follow a payload that carries no layer id", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, () => true, handler, {
      events: [EVENTS.MODE_CHANGE],
    });

    const bus = ensureEvents(map as never);
    bus.publish(EVENTS.MODE_CHANGE, { component: "MeasureControl", mode: "distance" });
    await nextFrame();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0][0].event).toBe(EVENTS.MODE_CHANGE);
  });

  it("ignores a non-layer payload for an id selector", async () => {
    const map = makeMap();
    const handler = vi.fn();
    subscribeLayers(map as never, ["a"], handler, { events: [EVENTS.MODE_CHANGE] });

    const bus = ensureEvents(map as never);
    bus.publish(EVENTS.MODE_CHANGE, { component: "MeasureControl", mode: "distance" });
    await nextFrame();

    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores a snapshot delivery that arrives after teardown", async () => {
    const map = makeMap();
    const bus = ensureEvents(map as never);
    const handler = vi.fn();
    const held: { stop?: () => void } = {};

    // A sibling subscriber (internal phase runs first) tears the layer
    // subscription down while this round is still walking the bus snapshot;
    // the captured listener must notice and stop.
    bus.on(EVENTS.LAYER_CHANGE, () => held.stop?.(), "internal");
    held.stop = subscribeLayers(map as never, ["a"], handler);

    bus.emit(EVENTS.LAYER_CHANGE, layerChange("a"));
    await nextFrame();

    expect(handler).not.toHaveBeenCalled();
  });
});
