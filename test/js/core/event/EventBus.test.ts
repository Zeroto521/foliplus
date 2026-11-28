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
    bus.emit("evt", 1);
    expect(handler).toHaveBeenCalledWith(1, { revision: 1 });
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
    operation.emit("first", { id: "a", kind: "vector" as const });
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

  it("emit rejects a notification event (fail-fast is the wrong contract)", () => {
    const bus = new EventBus();
    bus.on(EVENTS.MODE_CHANGE, vi.fn());
    expect(() =>
      bus.emit(EVENTS.MODE_CHANGE, { component: "MeasureControl", mode: "distance" }),
    ).toThrow(/notification/);
  });

  it("emitSuperseding rejects a notification event", () => {
    const bus = new EventBus();
    bus.on(EVENTS.MODE_CHANGE, vi.fn());
    expect(() =>
      bus.emitSuperseding(EVENTS.MODE_CHANGE, "layer-a", {
        component: "MeasureControl",
        mode: "distance",
      }),
    ).toThrow(/notification/);
  });

  it("absorb resolves by policy when the event is given", () => {
    const bus = new EventBus();
    // Notification event -> consumed, not raised.
    const notification = new SettledOperation(bus);
    notification.absorb({ error: new Error("n") }, EVENTS.MODE_CHANGE);
    expect(() => notification.throwIfFailed()).not.toThrow();
    // Terminal event -> kept and raised.
    const terminal = new SettledOperation(bus);
    terminal.absorb({ error: new Error("t") }, EVENTS.LAYER_CHANGE);
    expect(() => terminal.throwIfFailed()).toThrow("t");
    // No event -> kept unconditionally (the projection contract).
    const bare = new SettledOperation(bus);
    bare.absorb({ error: new Error("x") });
    expect(() => bare.throwIfFailed()).toThrow("x");
  });

  it("re-on with a different phase upgrades the registration", () => {
    const bus = new EventBus();
    const seen: string[] = [];
    const fn = () => seen.push("fn");
    bus.on("evt", () => seen.push("ext"));
    bus.on("evt", fn, "external");
    bus.on("evt", fn, "internal"); // upgrade — must not stay behind the observer
    bus.emit("evt");
    expect(seen).toEqual(["fn", "ext"]);
  });

  it("a void event carries no payload (the void contract)", () => {
    // The void-event branch of every emit variant: the payload slot stays
    // empty no matter how many rest args the call site passes.
    const bus = new EventBus();
    const emitHandler = vi.fn();
    const supersedingHandler = vi.fn();
    const settledHandler = vi.fn();
    const publishHandler = vi.fn();
    // LAYER_LIST_REBUILD is void *and* terminal — the void contract without
    // the notification fail-fast gate. OVERLAY_CLEAR is void too, but its
    // notification policy routes it through publish (covered by publish below).
    bus.on(EVENTS.LAYER_LIST_REBUILD, emitHandler);
    bus.on(EVENTS.LAYER_LIST_REBUILD, supersedingHandler, "external");
    bus.on(EVENTS.LAYER_LIST_REBUILD, settledHandler, "external");
    bus.on(EVENTS.OVERLAY_CLEAR, publishHandler, "external");
    bus.emit(EVENTS.LAYER_LIST_REBUILD);
    bus.emitSuperseding(EVENTS.LAYER_LIST_REBUILD, "rebuild");
    bus.emitSettled(EVENTS.LAYER_LIST_REBUILD);
    bus.publish(EVENTS.OVERLAY_CLEAR);
    const listHandlers = [emitHandler, supersedingHandler, settledHandler];
    listHandlers.forEach(h => {
      // Three rounds on LAYER_LIST_REBUILD: emit, emitSuperseding, emitSettled.
      expect(h).toHaveBeenCalledTimes(3);
      h.mock.calls.forEach((call, round) => {
        expect(call[0]).toBeUndefined();
        expect(call[1]).toEqual({ revision: round + 1 });
      });
    });
    expect(publishHandler).toHaveBeenCalledTimes(1);
    expect(publishHandler.mock.calls[0][0]).toBeUndefined();
    expect(publishHandler.mock.calls[0][1]).toEqual({ revision: 4 });
  });

  it("a payload-only emit (no origin) leaves the origin slot empty", () => {
    // The origin branch of every emit variant when only the payload is
    // given: the delivery meta carries no origin.
    const bus = new EventBus();
    const seen: unknown[] = [];
    const readOrigin = (_payload: unknown, meta?: { origin?: unknown }) =>
      seen.push(meta?.origin);
    bus.on("evt", readOrigin);
    bus.on("evt", readOrigin, "external");
    bus.emit("evt", 1);
    bus.emitSuperseding("evt", "layer-a", 1);
    bus.emitSettled("evt", 1);
    bus.emitSupersedingSettled("evt", "layer-a", 1);
    bus.publish("evt", 1);
    expect(seen).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("a void event carries its origin in the meta when one is given", () => {
    // The void+origin arm: a void event's single rest arg is read as the
    // origin (there is no payload slot to fill), so the delivery meta names
    // the origin the producer declared.
    const bus = new EventBus();
    const seen: unknown[] = [];
    const readMeta = (_payload: unknown, meta?: { origin?: unknown }) =>
      seen.push(meta?.origin);
    const origin = { kind: "user", via: "panel" } as const;
    bus.on(EVENTS.LAYER_LIST_REBUILD, readMeta);
    bus.on(EVENTS.LAYER_LIST_REBUILD, readMeta, "external");
    bus.on(EVENTS.LAYER_LIST_REBUILD, readMeta, "external");
    bus.on(EVENTS.LAYER_LIST_REBUILD, readMeta, "external");
    bus.on(EVENTS.LAYER_LIST_REBUILD, readMeta, "external");
    bus.emit(EVENTS.LAYER_LIST_REBUILD, origin);
    bus.emitSuperseding(EVENTS.LAYER_LIST_REBUILD, "rebuild", origin);
    bus.emitSettled(EVENTS.LAYER_LIST_REBUILD, origin);
    bus.emitSupersedingSettled(EVENTS.LAYER_LIST_REBUILD, "rebuild", origin);
    bus.publish(EVENTS.LAYER_LIST_REBUILD, origin);
    expect(seen).toEqual([origin, origin, origin, origin, origin]);
  });

  it("a data-bearing emit without an origin leaves the origin slot empty in every variant", () => {
    // The data-bearing + no-origin arm across all five emit variants: the
    // origin resolution falls through to `undefined` because only the
    // payload is on the rest tuple. Custom event names bypass the policy
    // gate (unregistered events carry no policy), so a single bus drives
    // every variant without tripping the notification fail-fast.
    const bus = new EventBus();
    const seen: unknown[] = [];
    const readMeta = (_payload: unknown, meta?: { origin?: unknown }) =>
      seen.push(meta?.origin);
    for (let i = 0; i < 5; i++) bus.on("evt", readMeta, "external");
    bus.emit("evt", { n: 1 });
    bus.emitSuperseding("evt", "layer-a", { n: 1 });
    bus.emitSettled("evt", { n: 1 });
    bus.emitSupersedingSettled("evt", "layer-a", { n: 1 });
    bus.publish("evt", { n: 1 });
    expect(seen).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("a data-bearing emit with an origin names it in the meta across every variant", () => {
    // The data-bearing + origin arm: the origin rides after the payload as
    // the second rest arg, so the delivery meta names who initiated the
    // change. Every variant reads that slot; none can drop it silently.
    const bus = new EventBus();
    const seen: unknown[] = [];
    const readMeta = (_payload: unknown, meta?: { origin?: unknown }) =>
      seen.push(meta?.origin);
    for (let i = 0; i < 5; i++) bus.on(EVENTS.LAYER_CHANGE, readMeta, "external");
    const origin = { kind: "user", via: "panel" } as const;
    bus.emit(EVENTS.LAYER_CHANGE, { id: "a", kind: "vector" as const }, origin);
    bus.emitSuperseding(
      EVENTS.LAYER_CHANGE,
      "a",
      { id: "a", kind: "vector" as const },
      origin,
    );
    bus.emitSettled(EVENTS.LAYER_CHANGE, { id: "a", kind: "vector" as const }, origin);
    bus.emitSupersedingSettled(
      EVENTS.LAYER_CHANGE,
      "a",
      { id: "a", kind: "vector" as const },
      origin,
    );
    bus.publish(EVENTS.LAYER_CHANGE, { id: "a", kind: "vector" as const }, origin);
    expect(seen).toEqual([origin, origin, origin, origin, origin]);
  });

  it("a data-bearing emit with no arguments leaves both slots empty", () => {
    // The `args.length === 0` arm of a data-bearing event: an out-of-tree
    // producer that emits with no rest args at all cannot strand the delivery
    // — the payload and origin both fall through to `undefined`. The typed
    // emit contract rejects this at compile time, so the test casts to the
    // rest-tuple form to pin the runtime behaviour.
    const bus = new EventBus();
    const seen: unknown[] = [];
    const readBoth = (payload: unknown, meta?: { origin?: unknown }) =>
      seen.push([payload, meta?.origin]);
    for (let i = 0; i < 4; i++) bus.on(EVENTS.LAYER_CHANGE, readBoth, "external");
    // Bind each method to the bus so the cast to a bare function shape does
    // not drop the receiver — the cast is only about the rest-tuple contract.
    const noArgs = bus.emit.bind(bus) as (event: string) => void;
    noArgs(EVENTS.LAYER_CHANGE);
    const noArgsSuperseding = bus.emitSuperseding.bind(bus) as (
      event: string,
      key: string,
    ) => void;
    noArgsSuperseding(EVENTS.LAYER_CHANGE, "a");
    const noArgsSettled = bus.emitSettled.bind(bus) as (event: string) => void;
    noArgsSettled(EVENTS.LAYER_CHANGE);
    // A void event's emitSupersedingSettled no-args arm: the supersede key
    // is the only arg, so the payload slot stays empty.
    const noArgsVoidSuperseding = bus.emitSupersedingSettled.bind(bus) as (
      event: string,
      key: string,
    ) => void;
    const voidSeen: unknown[] = [];
    bus.on(
      EVENTS.LAYER_LIST_REBUILD,
      (payload: unknown, meta?: { origin?: unknown }) =>
        voidSeen.push([payload, meta?.origin]),
      "external",
    );
    noArgsVoidSuperseding(EVENTS.LAYER_LIST_REBUILD, "rebuild");
    expect(voidSeen).toEqual([[undefined, undefined]]);
    const noArgsPublish = bus.publish.bind(bus) as (event: string) => void;
    noArgsPublish(EVENTS.LAYER_CHANGE);
    expect(seen).toEqual([
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
      [undefined, undefined],
    ]);
  });

  it("publish raises the first failure of a terminal event", () => {
    // The resolveByPolicy throw arm: a terminal event that a handler fails
    // collects the first failure through the collect dispatch, and publish
    // raises it once the fan-out is done.
    const bus = new EventBus();
    bus.on(EVENTS.LAYER_CHANGE, () => {
      throw new Error("terminal boom");
    });
    expect(() =>
      bus.publish(EVENTS.LAYER_CHANGE, { id: "a", kind: "vector" as const }),
    ).toThrow("terminal boom");
  });

  it("listenerCount counts every listener across events", () => {
    const bus = new EventBus();
    bus.on("a", vi.fn());
    bus.on("a", vi.fn());
    bus.on("b", vi.fn());
    expect(bus.listenerCount).toBe(3);
    expect(bus.eventCount).toBe(2);
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

  it("keeps the OVERLAY_CLEAR wire name stable", () => {
    // Only OVERLAY_CLEAR is a downstream wire contract — external consumers
    // subscribe by literal. The other EVENTS names are internal semantic
    // channels with no literal-stability promise. Renaming this one would
    // break consumers silently; this pin is the only thing that makes it loud.
    expect(EVENTS.OVERLAY_CLEAR).toBe("foliplus:layer:overlay-clear");
  });
});

describe("delivery revision", () => {
  it("stamps a monotonic revision per delivery and costs nothing without listeners", () => {
    const bus = new EventBus();
    expect(bus.revision).toBe(0);

    // No listener: no delivery, so no bump (the zero-cost requirement).
    bus.emit("evt", 1);
    bus.publish("evt", 1);
    expect(bus.revision).toBe(0);

    const seen: Array<number | undefined> = [];
    bus.on("evt", (_payload: unknown, meta?: { revision: number }) =>
      seen.push(meta?.revision),
    );
    bus.emit("evt", 1);
    bus.emitSuperseding("evt", "layer-a", 2);
    bus.emitSettled("evt", 3);
    bus.emitSupersedingSettled("evt", "layer-a", 4);
    bus.publish("evt", 5);

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(bus.revision).toBe(5);
  });

  it("keeps counting across clear() — the stamp is monotonic per bus", () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const read = (_p: unknown, meta?: { revision: number }) =>
      seen.push(meta?.revision as number);
    bus.on("evt", read);
    bus.emit("evt", 1);
    bus.clear();
    bus.on("evt", read);
    bus.emit("evt", 2);
    expect(seen).toEqual([1, 2]);
  });

  it("logs once when a handler re-enters the bus more than three levels deep", () => {
    // The reentrancy rule is a comment, not a prohibition; the one guard is a
    // warning so a handler that synchronously emits terminal events is visible
    // instead of silently nesting. Warned once per bus, not per nested round.
    const bus = new EventBus();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let depth = 0;
      bus.on("evt", () => {
        if (depth++ < 4) bus.emit("evt");
      });
      bus.emit("evt");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("nested more than 3 deep");
    } finally {
      warn.mockRestore();
    }
  });
  it("treats every void payload contract as void at runtime", () => {
    // The runtime mirror of the type map: if a name here were missing from
    // VOID_EVENTS, the origin argument would arrive in the payload slot and
    // the meta would lose it — exactly the drift `resolveOrigin` depends on.
    const bus = new EventBus();
    const origin = { kind: "system" } as const;
    const voidEvents = [
      EVENTS.LAYER_LIST_REBUILD,
      EVENTS.LAYER_NO_BASEMAP_CHANGED,
      EVENTS.OVERLAY_CLEAR,
    ] as const;
    for (const event of voidEvents) {
      const handler = vi.fn();
      bus.on(event, handler);
      bus.emitSettled(event, origin);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toBeUndefined();
      expect(handler.mock.calls[0][1]).toEqual({
        revision: expect.any(Number),
        origin,
      });
    }
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

  it("keeps the original bus across repeat calls", () => {
    const map = { on: vi.fn() } as any;
    const a = ensureEvents(map);
    ensureEvents(map);
    expect(map.foliplus.events).toBe(a);
  });

  it("preserves sibling namespace members already installed by other factories", () => {
    const map = {
      foliplus: { hint: { set: "hint", clear: vi.fn(), registerIcon: vi.fn() } },
      on: vi.fn(),
    } as any;
    ensureEvents(map);
    expect(map.foliplus.hint.set).toBe("hint");
    expect(map.foliplus.events).toBeDefined();
  });

  it("clears the bus when the map unloads", () => {
    const map = { on: vi.fn() } as any;
    const bus = ensureEvents(map);
    const handler = vi.fn();
    bus.on("evt", handler);
    const unload = map.on.mock.calls.find((c: unknown[]) => c[0] === "unload");
    expect(unload).toBeDefined();
    (unload![1] as () => void)();

    bus.emit("evt");
    expect(handler).not.toHaveBeenCalled();
  });

  it("emits through the namespace handle components actually read", () => {
    const map = { on: vi.fn() } as any;
    // Subscribe on the locally held bus, emit through the namespace. The
    // assertion only means something if the two are the same object — which is
    // what the callers actually rely on.
    const bus = ensureEvents(map);
    const seen: unknown[] = [];
    bus.on(EVENTS.MODE_CHANGE, (p: unknown) => seen.push(p));
    map.foliplus.events.publish(EVENTS.MODE_CHANGE, {
      component: "MeasureControl",
      mode: "distance",
    });
    expect(seen).toEqual([{ component: "MeasureControl", mode: "distance" }]);
  });
});
