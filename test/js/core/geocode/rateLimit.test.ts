import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createThrottleQueue,
  lastRequestAt,
  markRequest,
} from "#core/geocode/rateLimit.js";

describe("createThrottleQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs immediately when idle, then spaces subsequent calls by the interval", async () => {
    const queue = createThrottleQueue("a", 100);
    const order: string[] = [];
    const first = queue(() => {
      order.push("first");
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(0);
    await first;
    expect(order).toEqual(["first"]);

    const second = queue(() => {
      order.push("second");
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["first"]); // interval not elapsed — still queued

    await vi.advanceTimersByTimeAsync(50);
    await second;
    expect(order).toEqual(["first", "second"]);
  });

  it("serializes overlapping calls — no two tasks run concurrently", async () => {
    const queue = createThrottleQueue("b", 10);
    const order: string[] = [];
    const slow = queue(async () => {
      order.push("start-slow");
      await new Promise(r => setTimeout(r, 30));
      order.push("end-slow");
    });
    const second = queue(() => {
      order.push("start-second");
      return Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(200);
    await slow;
    await second;
    expect(order).toEqual(["start-slow", "end-slow", "start-second"]);
  });

  it("recovers after a task rejects — the queue stays usable", async () => {
    const queue = createThrottleQueue("c", 10);
    const boom = queue(() => Promise.reject(new Error("boom")));
    await vi.advanceTimersByTimeAsync(0);
    await expect(boom).rejects.toThrow("boom");

    const next = queue(() => Promise.resolve("ok"));
    await vi.advanceTimersByTimeAsync(20);
    await expect(next).resolves.toBe("ok");
  });
});

describe("provider-wide request clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records and reads request timestamps per id", () => {
    expect(lastRequestAt("z1")).toBe(0);
    markRequest("z1", 42);
    expect(lastRequestAt("z1")).toBe(42);
  });

  it("a queue honours requests recorded by other paths (e.g. suggestions)", async () => {
    // Simulate a suggestion request just happened on this provider id.
    markRequest("z2", Date.now());
    const queue = createThrottleQueue("z2", 100);
    const called = vi.fn(() => Promise.resolve());
    const task = queue(called);
    await vi.advanceTimersByTimeAsync(50);
    expect(called).not.toHaveBeenCalled(); // interval not elapse since the external request
    await vi.advanceTimersByTimeAsync(50);
    await task;
    expect(called).toHaveBeenCalledTimes(1);
  });

  it("honours the strictest min-interval declared for an id", async () => {
    markRequest("z3", Date.now()); // anchor the clock so the 500ms window binds
    createThrottleQueue("z3", 100);
    const queue = createThrottleQueue("z3", 500); // stricter declaration wins
    const called = vi.fn(() => Promise.resolve());
    const task = queue(called);
    await vi.advanceTimersByTimeAsync(200);
    expect(called).not.toHaveBeenCalled(); // still inside the 500ms window
    await vi.advanceTimersByTimeAsync(300);
    await task;
    expect(called).toHaveBeenCalledTimes(1);
  });
});
