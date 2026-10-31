import { describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#foliplus/core/event/index.js";

// ensureEvents is one of the five factories that seed map.foliplus (via
// ensureMapFoliplus). Pin its contract: one bus per map, and the bus is the
// object reachable as map.foliplus.events — components talk to each other
// through that handle, not through their own local reference.

type StubMap = {
  foliplus?: {
    events?: {
      emit: (e: string, p: unknown) => void;
      publish: (e: string, p: unknown) => void;
    };
  } & Record<string, unknown>;
  on: (t: string, f: unknown) => void;
};

const makeMap = (): StubMap => ({ on: vi.fn() });

describe("ensureEvents", () => {
  it("creates a bus and attaches it to map.foliplus.events", () => {
    const map = makeMap();
    const bus = ensureEvents(map);
    expect(map.foliplus?.events).toBe(bus);
  });

  it("is idempotent — the same bus is returned and reused", () => {
    const map = makeMap();
    const a = ensureEvents(map);
    expect(ensureEvents(map)).toBe(a);
  });

  it("keeps the original bus across repeat calls", () => {
    const map = makeMap();
    const a = ensureEvents(map);
    ensureEvents(map);
    expect(map.foliplus?.events).toBe(a);
  });

  it("creates independent buses per map", () => {
    expect(ensureEvents(makeMap())).not.toBe(ensureEvents(makeMap()));
  });

  it("preserves sibling namespace members already installed by other factories", () => {
    const map: StubMap = { foliplus: { showHint: "hint" }, on: vi.fn() };
    ensureEvents(map);
    expect(map.foliplus?.showHint).toBe("hint");
    expect(map.foliplus?.events).toBeDefined();
  });

  it("clears the bus when the map unloads", () => {
    const map = makeMap();
    const bus = ensureEvents(map);
    const handler = vi.fn();
    bus.on("evt", handler);
    const unload = (map.on as ReturnType<typeof vi.fn>).mock.calls.find(
      c => c[0] === "unload",
    );
    expect(unload).toBeDefined();
    (unload![1] as () => void)();

    bus.emit("evt");
    expect(handler).not.toHaveBeenCalled();
  });

  it("pins the published layer event literals", () => {
    // EventBus accepts a raw string, so these values are part of the public
    // contract: an external consumer that subscribed before a rename would go
    // silently deaf. Pin the two an outside/older code path is most likely to
    // hard-code, and keep a rename an explicit, migrated change.
    expect(EVENTS.OVERLAY_CLEAR).toBe("foliplus:layer:overlay-clear");
    expect(EVENTS.LAYER_FILTER_CHANGE).toBe("foliplus:layer:filter-change");
  });

  it("delivers overlay-clear to a subscriber that hard-codes the old literal", () => {
    const map = makeMap();
    const bus = ensureEvents(map);
    const spy = vi.fn<() => void>();
    bus.on("foliplus:layer:overlay-clear", spy);

    bus.publish(EVENTS.OVERLAY_CLEAR);

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("emits through the namespace handle components actually read", () => {
    const map = makeMap();
    // Subscribe on the locally held bus, emit through the namespace. The
    // assertion only means something if the two are the same object — which is
    // what the callers actually rely on.
    const bus = ensureEvents(map);
    const seen: unknown[] = [];
    bus.on(EVENTS.MODE_CHANGE, (p: unknown) => seen.push(p));
    map.foliplus!.events!.publish(EVENTS.MODE_CHANGE, {
      component: "MeasureControl",
      mode: "distance",
    });
    expect(seen).toEqual([{ component: "MeasureControl", mode: "distance" }]);
  });
});
