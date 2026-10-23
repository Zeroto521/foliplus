import { describe, expect, it, vi } from "vitest";
import {
  EVENTS,
  EventBus,
  SettledOperation,
  ensureEvents,
} from "#foliplus/core/event/index.js";

/** The private in-flight token map, read the way the token-leak tests do. */
function supersedingSize(bus: EventBus): number {
  return (bus as unknown as { superseding: Map<string, object> }).superseding.size;
}

describe("EventBus", () => {
  it("subscribes and receives emitted events", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("evt", handler);
    bus.emit("evt", 1, 2);
    expect(handler).toHaveBeenCalledWith(1, 2);
  });

  it("rejects an omitted payload on a data-bearing event (typed emit contract)", () => {
    // Compile-time contract for the typed emit overload: a data-bearing event
    // cannot be emitted without its payload. The rest-tuple form
    // (`...args: EventPayloadMap[K] extends void ? [] : [payload]`) is what
    // makes this a real error rather than a soft fallthrough — a separate
    // `emit<K>(event: K): void` overload would accept every K, silently
    // dropping the payload requirement. `@ts-expect-error` fails the build if
    // the hole ever comes back.
    const bus = new EventBus();
    // @ts-expect-error LAYER_ITEM_ADDED's payload `{ id: string }` is required
    bus.emit(EVENTS.LAYER_ITEM_ADDED);
    // @ts-expect-error LAYER_CHANGE's payload is required
    bus.emit(EVENTS.LAYER_CHANGE);
    // A void-payload event takes no argument — this line MUST compile.
    bus.emit(EVENTS.LAYER_LIST_REBUILD);
  });

  it("off removes a specific handler", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("evt", a);
    bus.on("evt", b);
    bus.off("evt", a);
    bus.emit("evt");
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("on returns an unsubscribe function", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const unsubscribe = bus.on("evt", handler);
    unsubscribe();
    bus.emit("evt");
    expect(handler).not.toHaveBeenCalled();
  });

  it("handlers may subscribe/unsubscribe during emit (copy-before-iterate)", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const late = vi.fn(() => seen.push(2));
    const early = vi.fn(() => {
      seen.push(1);
      bus.on("evt", late); // added during emit — must NOT fire this round
    });
    bus.on("evt", early);
    bus.emit("evt");
    expect(seen).toEqual([1]);
    bus.emit("evt");
    expect(seen).toEqual([1, 1, 2]); // late fires from the second emit
  });

  it("clear removes all listeners", () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on("x", a);
    bus.on("y", b);
    bus.clear();
    bus.emit("x");
    bus.emit("y");
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(bus.eventCount).toBe(0);
  });

  it("emitSuperseding stops an in-flight delivery a newer write supersedes", () => {
    // The first handler rewrites the value synchronously inside its own
    // delivery. The fresh round delivers to everyone, and the *older* round —
    // still walking its handlers when the rewrite happened — stops at the
    // reentry point: the handler behind it never receives a value the rewrite
    // has already replaced.
    const bus = new EventBus();
    const key = "layer-a";
    const seen: string[] = [];
    const value = (payload: unknown): string => (payload as { value: string }).value;
    bus.on("evt", payload => {
      if (value(payload) === "old") bus.emitSuperseding("evt", key, { value: "new" });
    });
    bus.on("evt", payload => {
      seen.push(value(payload));
    });

    bus.emitSuperseding("evt", key, { value: "old" });

    // The fresh round delivers to everyone; the stale "old" never reaches the
    // second handler — a plain emit would have delivered ["old", "new"].
    expect(seen).toEqual(["new"]);
  });

  it("emitSuperseding delivers normally without a superseding rewrite", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const value = (payload: unknown): string => (payload as { value: string }).value;
    bus.on("evt", payload => {
      seen.push(value(payload));
    });
    bus.on("evt", payload => {
      seen.push(value(payload));
    });
    bus.emitSuperseding("evt", "layer-a", { value: "v" });
    expect(seen).toEqual(["v", "v"]);
  });

  it("emitSuperseding is a no-op when nobody listens", () => {
    const bus = new EventBus();
    expect(() =>
      bus.emitSuperseding("silent", "layer-a", { value: "v" }),
    ).not.toThrow();
    // And an event with listeners stays untouched by the silent key.
    const seen: string[] = [];
    bus.on("evt", payload => {
      seen.push((payload as { value: string }).value);
    });
    bus.emitSuperseding("silent", "layer-a", { value: "v" });
    expect(seen).toEqual([]);
  });

  it("a throwing handler does not strand the supersede token", () => {
    // Exceptions propagate to the emitter by contract; the token the delivery
    // held must still be released, or every (event, id) that ever threw would
    // grow the map forever.
    const bus = new EventBus();
    bus.on("evt", () => {
      throw new Error("consumer boom");
    });
    expect(() => bus.emitSuperseding("evt", "layer-a", { value: "v" })).toThrow(
      "consumer boom",
    );
    expect(
      (bus as unknown as { superseding: Map<string, object> }).superseding.size,
    ).toBe(0);
  });

  it("the outer finally leaves the inner supersede token to its owner", () => {
    // The first handler rewrites the value mid-delivery. The outer delivery
    // stops at the reentry point and its finally must NOT delete the inner's
    // token — the inner owns it and clears it when it finishes.
    const bus = new EventBus();
    const key = "layer-a";
    bus.on("evt", payload => {
      if ((payload as { value: string }).value === "old") {
        bus.emitSuperseding("evt", key, { value: "new" });
      }
    });
    bus.emitSuperseding("evt", key, { value: "old" });
    expect(
      (bus as unknown as { superseding: Map<string, object> }).superseding.size,
    ).toBe(0);
  });

  it("emitSupersedingSettled keeps delivering after a throwing handler", () => {
    // A state broadcast has independent consumers and none of them owns the
    // others. The first one throws; the rest still see the round, and the
    // first failure comes back to the emitter for it to raise after its own
    // fan-out. A plain emit would have stopped at the throw and taken the
    // notification from every consumer behind it.
    const bus = new EventBus();
    const first = new Error("first boom");
    const second = new Error("second boom");
    const delivered: string[] = [];
    bus.on("evt", () => {
      throw first;
    });
    bus.on("evt", () => {
      throw second;
    });
    bus.on("evt", () => {
      delivered.push("last");
    });

    const failure = bus.emitSupersedingSettled("evt", "layer-a", { value: "v" });

    expect(failure?.error).toBe(first); // first failure, not an aggregate
    expect(delivered).toEqual(["last"]);
  });

  it("emitSupersedingSettled returns undefined when every handler succeeds", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on("evt", payload => {
      seen.push((payload as { value: string }).value);
    });
    expect(
      bus.emitSupersedingSettled("evt", "layer-a", { value: "v" }),
    ).toBeUndefined();
    expect(seen).toEqual(["v"]);
  });

  it("emitSupersedingSettled distinguishes a thrown undefined from success", () => {
    // `throw undefined` is legal JS. A bare `unknown` return would read it as
    // "nothing failed"; the failure wrapper keeps the two cases apart.
    const bus = new EventBus();
    // Through an `unknown` binding: the throw itself is the point, and the
    // lint rule against literal throws would otherwise hide the case.
    const thrown: unknown = undefined;
    bus.on("evt", () => {
      throw thrown;
    });
    const failure = bus.emitSupersedingSettled("evt", "layer-a", { value: "v" });
    expect(failure).toBeDefined();
    expect(failure?.error).toBeUndefined();
  });

  it("emitSupersedingSettled is a no-op when nobody listens", () => {
    const bus = new EventBus();
    expect(
      bus.emitSupersedingSettled("silent", "layer-a", { value: "v" }),
    ).toBeUndefined();
    expect(supersedingSize(bus)).toBe(0);
  });

  it("a newer round stops an older settled delivery", () => {
    const bus = new EventBus();
    const key = "layer-a";
    const seen: string[] = [];
    const value = (payload: unknown): string => (payload as { value: string }).value;
    bus.on("evt", payload => {
      if (value(payload) === "old") {
        bus.emitSupersedingSettled("evt", key, { value: "new" });
      }
    });
    bus.on("evt", payload => {
      seen.push(value(payload));
    });

    bus.emitSupersedingSettled("evt", key, { value: "old" });

    // The stale "old" never reaches the second handler; the correction own
    // round is the only one it sees.
    expect(seen).toEqual(["new"]);
  });

  it("a settled round returns a failure it observed before being superseded", () => {
    // Superseding stops delivery; it does not un-throw what already threw.
    // The handler that raised did raise, and its round is the only one that
    // saw it — dropping the failure because a later handler corrected the
    // value would hide the consumer bug behind an unrelated write.
    const bus = new EventBus();
    const key = "layer-a";
    const boom = new Error("boom");
    const seen: string[] = [];
    const value = (payload: unknown): string => (payload as { value: string }).value;
    bus.on("evt", payload => {
      if (value(payload) !== "old") return;
      bus.emitSupersedingSettled("evt", key, { value: "new" });
      throw boom;
    });
    bus.on("evt", payload => {
      seen.push(value(payload));
    });

    const failure = bus.emitSupersedingSettled("evt", key, { value: "old" });

    expect(failure?.error).toBe(boom);
    expect(seen).toEqual(["new"]);
  });

  it("a throwing settled handler does not strand the supersede token", () => {
    const bus = new EventBus();
    bus.on("evt", () => {
      throw new Error("consumer boom");
    });
    bus.emitSupersedingSettled("evt", "layer-a", { value: "v" });
    expect(supersedingSize(bus)).toBe(0);
  });

  it("clear during a settled delivery stops the handlers behind it", () => {
    // clear() takes the in-flight token with it, so the snapshot still in the
    // loop cannot deliver the rest of the round on a bus that was torn down.
    const bus = new EventBus();
    const later = vi.fn();
    bus.on("evt", () => bus.clear());
    bus.on("evt", later);

    expect(
      bus.emitSupersedingSettled("evt", "layer-a", { value: "v" }),
    ).toBeUndefined();
    expect(later).not.toHaveBeenCalled();
    expect(supersedingSize(bus)).toBe(0);
  });

  it("emitSettled keeps delivering after a throwing handler and returns the first failure", () => {
    const bus = new EventBus();
    const first = new Error("first boom");
    const delivered: string[] = [];
    bus.on("evt", () => {
      throw first;
    });
    bus.on("evt", () => {
      delivered.push("last");
    });

    const failure = bus.emitSettled("evt", { value: "v" });

    expect(failure?.error).toBe(first);
    expect(delivered).toEqual(["last"]);
  });

  it("emitSettled stops after clear()", () => {
    const bus = new EventBus();
    const later = vi.fn();
    bus.on("evt", () => bus.clear());
    bus.on("evt", later);

    expect(bus.emitSettled("evt", { value: "v" })).toBeUndefined();
    expect(later).not.toHaveBeenCalled();
  });

  it("SettledOperation finishes every queued event before raising the first failure", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on("first", () => {
      throw new Error("first boom");
    });
    bus.on("second", payload => {
      seen.push((payload as { id: string }).id);
    });

    const operation = new SettledOperation(bus);
    operation.emit("first", { id: "a" });
    operation.emit("second", { id: "b" });

    // Both events were attempted; the failure surfaces only at the boundary.
    expect(seen).toEqual(["b"]);
    expect(() => operation.throwIfFailed()).toThrow("first boom");
  });

  it("SettledOperation absorbs a batch failure into the same boundary", () => {
    const operation = new SettledOperation(new EventBus());
    const boom = new Error("batch boom");
    operation.absorb({ error: boom });
    operation.absorb({ error: new Error("second boom") });
    expect(() => operation.throwIfFailed()).toThrow("batch boom");
  });

  it("clear releases listeners and any supersede tokens", () => {
    const bus = new EventBus();
    // Simulate a delivery interrupted mid-flight (a handler that threw would
    // now release its own token, so park one directly for the clear test).
    (bus as unknown as { superseding: Map<string, object> }).superseding.set(
      "evt\u0000layer-a",
      {},
    );
    bus.on("evt", vi.fn());
    bus.clear();
    expect(bus.eventCount).toBe(0);
    expect(
      (bus as unknown as { superseding: Map<string, object> }).superseding.size,
    ).toBe(0);
  });

  it("eventCount tracks the number of events with listeners", () => {
    const bus = new EventBus();
    bus.on("a", vi.fn());
    bus.on("b", vi.fn());
    expect(bus.eventCount).toBe(2);
    bus.off("a", vi.fn()); // unknown handler — no change
    expect(bus.eventCount).toBe(2);
  });
});

describe("event constants", () => {
  it("all constants are distinct non-empty strings", () => {
    expect(typeof EVENTS.LAYER_CHANGE).toBe("string");
    expect(typeof EVENTS.LAYER_REMOVED).toBe("string");
    expect(typeof EVENTS.MODE_CHANGE).toBe("string");
    expect([EVENTS.LAYER_CHANGE, EVENTS.LAYER_REMOVED, EVENTS.MODE_CHANGE]).toEqual(
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ]),
    );
    expect(
      new Set([EVENTS.LAYER_CHANGE, EVENTS.LAYER_REMOVED, EVENTS.MODE_CHANGE]),
    ).toHaveLength(3);
  });
});

describe("ensureEvents", () => {
  it("attaches an EventBus to map.foliplus.events and is idempotent", () => {
    const map = {} as any;
    const e1 = ensureEvents(map);
    const e2 = ensureEvents(map);
    expect(e2).toBe(e1);
    expect(map.foliplus.events).toBe(e1);
  });

  it("is per-map — separate maps get separate buses", () => {
    const mapA = {} as any;
    const mapB = {} as any;
    expect(ensureEvents(mapA)).not.toBe(ensureEvents(mapB));
  });
});
