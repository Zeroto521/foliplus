import { beforeEach, describe, expect, it, vi } from "vitest";
import { rafLoop } from "#common/rafLoop.js";

describe("rafLoop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the tick on start plus one per scheduled frame", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start();
    // The first frame runs synchronously from start().
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16 * 3);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("stops running when stop() is called", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start();
    vi.advanceTimersByTime(16 * 2);
    expect(tick).toHaveBeenCalledTimes(3); // 1 sync + 2 frames
    loop.stop();
    vi.advanceTimersByTime(16 * 5);
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("stop() cancels the pending frame so it does not fire after stop", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start();
    loop.stop();
    vi.advanceTimersByTime(16 * 5);
    expect(tick).toHaveBeenCalledTimes(1); // the sync frame only
  });

  it("stops automatically when the tick returns true", () => {
    const tick = vi.fn(() => true);
    const loop = rafLoop(tick);
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16 * 4);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("passes the key through to each tick", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start("ArrowRight");
    vi.advanceTimersByTime(16 * 2);
    expect(tick).toHaveBeenCalledTimes(3);
    expect(tick).toHaveBeenCalledWith("ArrowRight");
  });

  it("does not pile up when start() is called again while running", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start("x");
    loop.start("y");
    loop.start("z");
    vi.advanceTimersByTime(16 * 3);
    // The repeated start() calls are no-ops; ticks are 1 sync + 3 frames.
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("new start() while running is a no-op (caller must stop first to switch direction)", () => {
    // This mirrors the key-direction-switch case in ExportControl: holding one
    // arrow then pressing another must stop the old loop first, otherwise a
    // stale loop keeps nudging the old direction for ~500ms. rafLoop itself
    // does not auto-stop on a second start() — it coalesces — so the caller
    // owns the stop-before-start contract.
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start("ArrowRight");
    expect(tick).toHaveBeenCalledTimes(1);
    loop.start("ArrowUp"); // coalesced: no-op, original loop still runs
    vi.advanceTimersByTime(16 * 3);
    expect(tick).toHaveBeenCalledTimes(4); // ticks on the original, rightward loop
  });

  it("the continuation callback is skipped after stop() so a pending frame never fires", () => {
    // Covers the `if (!running) return;` guard inside the scheduled callback.
    // stop() sets running=false AND clears pending, so the pending callback
    // never fires at all. This test verifies the guard still works when a
    // callback fires after running is set to false through some other path —
    // here we inject a scheduler that lets us observe the callback body.
    const tick = vi.fn(() => false);
    let fireCallback!: () => void;
    const loop = rafLoop(tick, {
      scheduler: fn => {
        fireCallback = fn;
        return 0;
      },
    });
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1); // sync first frame
    loop.stop(); // running = false
    fireCallback!(); // callback body runs, but `!running` bails it out
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("a scheduled frame whose tick returns true stops the loop", () => {
    // Covers the `if (tick(key)) return stop();` branch inside the scheduled
    // callback — distinct from the sync first-frame path which is already
    // tested separately. Captures the callback and fires it manually so we can
    // control when tick returns true.
    let tickCount = 0;
    let shouldStop = false;
    let fireCallback!: () => void;
    const loop = rafLoop(
      () => {
        tickCount++;
        return shouldStop;
      },
      {
        scheduler: fn => {
          fireCallback = fn;
          return 0;
        },
      },
    );
    loop.start();
    expect(tickCount).toBe(1); // sync first frame

    // Scheduled frame: tick returns false → callback re-arms.
    fireCallback!();
    expect(tickCount).toBe(2);

    // Next scheduled frame: tick returns true → callback stops the loop.
    shouldStop = true;
    fireCallback!();
    expect(tickCount).toBe(3);

    // Loop is stopped: further fires hit the `!running` guard.
    shouldStop = false;
    fireCallback!();
    expect(tickCount).toBe(3);
  });

  it("a scheduled frame whose tick returns false re-arms the next frame", () => {
    // Covers the `if (running) schedule();` continuation branch. Using a
    // real scheduler so that each frame auto-re-arms via rafLoop itself,
    // not the test. The "1 sync + N frames" count in the first test already
    // demonstrates this; here we additionally verify that stop() halts the
    // re-arm chain mid-way so no extra frames appear.
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16 * 2);
    expect(tick).toHaveBeenCalledTimes(3); // 1 sync + 2 re-armed frames
    loop.stop();
    vi.advanceTimersByTime(16 * 100); // no further re-arms after stop
    expect(tick).toHaveBeenCalledTimes(3);
  });

  it("starts on the next start() after it stopped", () => {
    const tick = vi.fn(() => true); // first call stops it
    const loop = rafLoop(tick);
    loop.start("a");
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(16);
    // Re-arming: tick now no longer stops.
    tick.mockReturnValue(false);
    loop.start("b");
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16 * 2);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("ramp delays the first scheduled frame so a brief tap yields only the sync step", () => {
    // A tap shorter than the ramp produces only the sync frame — one step —
    // matching the pre-loop feel. A held key past the ramp then enters the
    // normal 16ms stream.
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick, { ramp: 200 });
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1); // sync frame

    // Before the ramp elapses: no further frames.
    vi.advanceTimersByTime(100);
    expect(tick).toHaveBeenCalledTimes(1);

    // Ramp elapses: the first scheduled frame fires.
    vi.advanceTimersByTime(101);
    expect(tick).toHaveBeenCalledTimes(2);

    // Then the stream runs at 16ms.
    vi.advanceTimersByTime(16 * 2);
    expect(tick).toHaveBeenCalledTimes(4); // + 2 frames at normal cadence
    loop.stop();
    vi.advanceTimersByTime(16 * 100);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("ramp applies only to the first frame — subsequent starts reuse the 16ms cadence", () => {
    // The ramp is a per-start first-frame delay, not a permanent slow-down.
    // After the first frame, the loop re-arms at 16ms even if the same loop
    // instance is re-started after stopping.
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick, { ramp: 200 });
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(201); // ramp → first scheduled frame
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16); // normal cadence after the first frame
    expect(tick).toHaveBeenCalledTimes(3);
    loop.stop();

    tick.mockReset();
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1); // new sync frame
    vi.advanceTimersByTime(201); // ramp applies again on a fresh start
    expect(tick).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16);
    expect(tick).toHaveBeenCalledTimes(3);
  });
});
