import { describe, expect, it, vi } from "vitest";
import { EventBus, ensureEvents } from "#foliplus/core/event/index.js";

describe("EventBus", () => {
  it("subscribes and receives emitted events", () => {
    const bus = new EventBus();
    const handler = vi.fn();
    bus.on("evt", handler);
    bus.emit("evt", 1, 2);
    expect(handler).toHaveBeenCalledWith(1, 2);
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
    expect(typeof LAYER_CHANGE).toBe("string");
    expect(typeof LAYER_REMOVED).toBe("string");
    expect(typeof MODE_CHANGE).toBe("string");
    expect([LAYER_CHANGE, LAYER_REMOVED, MODE_CHANGE]).toEqual(
      expect.arrayContaining([
        expect.any(String),
        expect.any(String),
        expect.any(String),
      ]),
    );
    expect(new Set([LAYER_CHANGE, LAYER_REMOVED, MODE_CHANGE])).toHaveLength(3);
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
