// The scoped timer owner: named timers, one release point, no fire after dispose.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTimers } from "#platform/timer.js";

describe("createTimers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("runs a named timeout after its delay and drops the name when it fires", () => {
    const timers = createTimers();
    const fn = vi.fn();

    timers.timeout("paint", fn, 60);
    expect(timers.names()).toEqual(["paint"]);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60);

    expect(fn).toHaveBeenCalledTimes(1);
    // A fired one-shot is not still scheduled: the name list is what a leak
    // report reads, so a stale entry would lie.
    expect(timers.names()).toEqual([]);
  });

  it("clear releases one name and leaves the others scheduled", () => {
    const timers = createTimers();
    const kept = vi.fn();
    const dropped = vi.fn();

    timers.timeout("kept", kept, 100);
    timers.timeout("dropped", dropped, 100);
    timers.clear("dropped");

    vi.advanceTimersByTime(100);

    expect(kept).toHaveBeenCalledTimes(1);
    expect(dropped).not.toHaveBeenCalled();
    expect(timers.names()).toEqual([]);
  });

  it("replaces a live timer when the same name is scheduled again", () => {
    const timers = createTimers();
    const first = vi.fn();
    const second = vi.fn();

    timers.timeout("opacity:L1", first, 100);
    vi.advanceTimersByTime(50);
    timers.timeout("opacity:L1", second, 100);

    // One name, one live timer: the first arm must not survive its replacement.
    expect(timers.names()).toEqual(["opacity:L1"]);
    vi.advanceTimersByTime(100);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("repeats an interval until it is cleared", () => {
    const timers = createTimers();
    const fn = vi.fn();

    timers.interval("poll", fn, 50);
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(3);

    timers.clear("poll");
    vi.advanceTimersByTime(150);
    expect(fn).toHaveBeenCalledTimes(3);
    // An interval has no natural exit, so only an explicit release empties it.
    expect(timers.names()).toEqual([]);
  });

  it("runs a named frame callback once", () => {
    const timers = createTimers();
    const fn = vi.fn();

    timers.raf("measure", fn);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(16);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(timers.names()).toEqual([]);
  });

  it("releases a pending frame through the frame canceller, not the timeout one", () => {
    const timers = createTimers();
    const fn = vi.fn();
    const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame");
    const cancelTimeout = vi.spyOn(globalThis, "clearTimeout");

    timers.raf("measure", fn);
    timers.clear("measure");

    // A frame id is not a timeout id: clearing it through clearTimeout is a
    // silent no-op, so the repaint would land after its owner released it —
    // exactly the leak this module exists to prevent.
    expect(cancelTimeout).not.toHaveBeenCalled();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(timers.names()).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("dispose releases a pending frame through the frame canceller", () => {
    const timers = createTimers();
    const fn = vi.fn();
    const cancelFrame = vi.spyOn(globalThis, "cancelAnimationFrame");

    timers.raf("measure", fn);
    timers.dispose();

    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(timers.names()).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("dispose clears every pending timer and none of them fire", () => {
    const timers = createTimers();
    const a = vi.fn();
    const b = vi.fn();
    const tick = vi.fn();

    timers.timeout("a", a, 100);
    timers.timeout("b", b, 100);
    timers.interval("tick", tick, 50);
    timers.dispose();

    vi.advanceTimersByTime(500);

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    expect(tick).not.toHaveBeenCalled();
    expect(timers.names()).toEqual([]);
    expect(timers.disposed).toBe(true);
  });

  it("drops a scheduling that arrives after dispose instead of running it", () => {
    const timers = createTimers();
    const late = vi.fn();
    timers.dispose();

    timers.timeout("late", late, 10);
    timers.raf("late-frame", late);

    // An effect scheduled by an owner that is already gone must not fire: that
    // is the leak the owner exists to prevent, not a timer worth keeping.
    expect(timers.names()).toEqual([]);
    vi.advanceTimersByTime(100);
    expect(late).not.toHaveBeenCalled();
  });

  it("is idempotent on dispose and clear after dispose", () => {
    const timers = createTimers();
    const fn = vi.fn();
    timers.timeout("a", fn, 100);

    expect(() => {
      timers.dispose();
      timers.dispose();
      timers.clear("a");
      timers.clear("never-scheduled");
    }).not.toThrow();

    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it("lets a one-shot callback re-schedule its own name", () => {
    const timers = createTimers();
    const runs: number[] = [];

    const again = (n: number) => {
      runs.push(n);
      if (n < 2) timers.timeout("loop", () => again(n + 1), 10);
    };
    timers.timeout("loop", () => again(0), 10);

    vi.advanceTimersByTime(100);

    // The callback leaves the map before running, so its own re-schedule is not
    // cancelled by the release that the fired arm would otherwise trigger.
    expect(runs).toEqual([0, 1, 2]);
    expect(timers.names()).toEqual([]);
  });
});
