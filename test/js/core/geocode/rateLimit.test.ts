import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThrottleQueue } from "#core/geocode/rateLimit.js";

describe("createThrottleQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs immediately when idle, then spaces subsequent calls by the interval", async () => {
    const queue = createThrottleQueue(100);
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
    const queue = createThrottleQueue(10);
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
});
