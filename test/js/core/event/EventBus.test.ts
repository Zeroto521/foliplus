import { describe, expect, it, vi } from "vitest";
import {
  EVENTS,
  EVENT_POLICY,
  EventBus,
  SettledOperation,
  ensureEvents,
} from "#foliplus/core/event/index.js";

/** Total in-flight supersede tokens across every event entry (token-leak
 *  checks). Tokens now live per event, so the leak surface is the union of
 *  every entry's in-flight map. */
const supersedingSize = (bus: EventBus): number => {
  const entries = (
    bus as unknown as {
      entries: Map<string, { inFlight: Map<string, object> }>;
    }
  ).entries;
  let n = 0;
  for (const entry of entries.values()) n += entry.inFlight.size;
  return n;
};

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
    expect(supersedingSize(bus)).toBe(0);
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
    expect(supersedingSize(bus)).toBe(0);
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
    const entries = (
      bus as unknown as {
        entries: Map<string, { inFlight: Map<string, object> }>;
      }
    ).entries;
    bus.on("evt", vi.fn());
    entries.get("evt")!.inFlight.set("layer-a", {});
    bus.clear();
    expect(bus.eventCount).toBe(0);
    expect(supersedingSize(bus)).toBe(0);
  });

  it("eventCount tracks the number of events with listeners", () => {
    const bus = new EventBus();
    bus.on("a", vi.fn());
    bus.on("b", vi.fn());
    expect(bus.eventCount).toBe(2);
    bus.off("a", vi.fn()); // unknown handler — no change
    expect(bus.eventCount).toBe(2);
  });

  it("internal listeners run before external ones regardless of subscription order", () => {
    // A third party subscribing early must never read half-cleared state
    // before the owner handled the event.
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on("evt", () => seen.push("external"));
    bus.on("evt", () => seen.push("internal-1"), "internal");
    bus.on("evt", () => seen.push("internal-2"), "internal");
    bus.emit("evt");
    expect(seen).toEqual(["internal-1", "internal-2", "external"]);
  });

  it("duplicate subscriptions collapse to one", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    const u1 = bus.on("evt", handler);
    const u2 = bus.on("evt", handler);
    bus.emit("evt");
    expect(handler).toHaveBeenCalledTimes(1);
    u1();
    u2();
    bus.emit("evt");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("notification failures are reported to the per-map onError hook", () => {
    const onError = vi.fn();
    const map = { foliplus: { onError } } as never;
    const bus = new EventBus(map);
    bus.on(EVENTS.MODE_CHANGE, () => {
      throw new Error("mode boom");
    });

    expect(() =>
      bus.publish(EVENTS.MODE_CHANGE, {
        component: "MeasureControl",
        mode: "distance",
      }),
    ).not.toThrow();

    expect(onError).toHaveBeenCalledWith(EVENTS.MODE_CHANGE, expect.any(Error));
  });

  it("a throwing onError hook cannot take the bus down", () => {
    const map = {
      foliplus: {
        onError: vi.fn(() => {
          throw new Error("hook boom");
        }),
      },
    } as never;
    const bus = new EventBus(map);
    bus.on(EVENTS.MODE_CHANGE, () => {
      throw new Error("mode boom");
    });

    expect(() =>
      bus.publish(EVENTS.MODE_CHANGE, {
        component: "MeasureControl",
        mode: "distance",
      }),
    ).not.toThrow();
  });

  it("resolves a notification policy after the entry is removed mid-delivery", () => {
    // A subscriber that unsubscribes itself (the only listener, so the entry
    // is dropped) and then throws must still be resolved by the *declared*
    // policy — consumeByPolicy falls back to the table, not to a stale entry.
    const bus = new EventBus();
    let unsubscribe: () => void = () => {};
    unsubscribe = bus.on(EVENTS.MODE_CHANGE, () => {
      unsubscribe();
      throw new Error("mode boom");
    });

    expect(() =>
      bus.publish(EVENTS.MODE_CHANGE, {
        component: "MeasureControl",
        mode: "distance",
      }),
    ).not.toThrow();
  });

  it("SettledOperation cannot bypass a notification policy", () => {
    // The same event must never get two exception contracts: publishing
    // MODE_CHANGE through an operation logs it, it does not raise it.
    const bus = new EventBus();
    bus.on(EVENTS.MODE_CHANGE, () => {
      throw new Error("mode boom");
    });
    const operation = new SettledOperation(bus);
    operation.emit(EVENTS.MODE_CHANGE, {
      component: "MeasureControl",
      mode: "distance",
    });
    expect(() => operation.throwIfFailed()).not.toThrow();
  });
});

describe("event constants", () => {
  it("declares a policy for every event", () => {
    const declared = new Set(Object.keys(EVENT_POLICY));
    for (const name of Object.values(EVENTS)) {
      expect(declared.has(name)).toBe(true);
    }
    expect(declared.size).toBe(Object.keys(EVENTS).length);
  });

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
