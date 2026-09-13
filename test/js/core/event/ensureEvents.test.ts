import { describe, expect, it, vi } from "vitest";
import { EVENTS, ensureEvents } from "#foliplus/core/event/index.js";

// ensureEvents is one of the five factories that seed map.foliplus (via
// ensureMapFoliplus). Pin its contract: one bus per map, and the bus is the
// object reachable as map.foliplus.events — components talk to each other
// through that handle, not through their own local reference.

type StubMap = {
  foliplus?: { events?: { emit: (e: string, p: unknown) => void } } & Record<
    string,
    unknown
  >;
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

  it("emits through the namespace handle components actually read", () => {
    const map = makeMap();
    // Subscribe on the locally held bus, emit through the namespace. The
    // assertion only means something if the two are the same object — which is
    // what the callers actually rely on.
    const bus = ensureEvents(map);
    const seen: unknown[] = [];
    bus.on(EVENTS.MODE_CHANGE, (p: unknown) => seen.push(p));
    map.foliplus!.events!.emit(EVENTS.MODE_CHANGE, { mode: "distance" });
    expect(seen).toEqual([{ mode: "distance" }]);
  });
});
