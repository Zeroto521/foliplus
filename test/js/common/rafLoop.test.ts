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

  it("cancel() drops the pending frame without scheduling another tick", () => {
    const tick = vi.fn(() => false);
    const loop = rafLoop(tick);
    loop.start();
    expect(tick).toHaveBeenCalledTimes(1);
    loop.cancel();
    // No timer registered, so advancing the clock never invokes tick again.
    vi.advanceTimersByTime(16 * 5);
    expect(tick).toHaveBeenCalledTimes(1);
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
});
