// platform/timer — named timers with one owner and one release point.
import type { Timers } from "./type.js";

// Every control schedules delayed work — a debounced repaint, a preview that
// closes itself, a hint that expires — and each site writes its own cleanup.
// That cleanup is only as complete as the author's memory: a repaint timer that
// outlived its panel (the #1367 leak) is one instance of the shape.
//
// This is the OWNERSHIP primitive, not another scheduling helper. The two
// neighbouring modules own call shapes, and must not grow this duty:
//
//   - platform/debounce   owns one call, coalesced to the last invocation;
//   - platform/throttle   owns one call, coalesced into one animation frame.
//
// Neither can answer "release everything this owner scheduled", and a control
// that needs three different delays would need three of them plus the bookkeeping
// this file exists to remove. One name per timer is what makes a teardown
// enumerable and a leak reportable: "opacity:L3" says which timer survived.
//
// Compose with the existing teardown, do not build a second mechanism: the
// panel registers the release as a step of its scope —
// `scope.step("timers", () => timers.dispose())` — and a manager calls
// `dispose()` from its own destroy. #platform/finalize stays the runner.
//
// Late registration runs in OPPOSITE directions here and in the scope, on
// purpose — the asymmetry is the contract, not something to smooth over:
//
//   - a scope step registered after `dispose` runs AT ONCE: late teardown work
//     must not be stranded, or a subscription taken during teardown leaks;
//   - a timer registered after `dispose` is DROPPED: a timer is an effect on
//     the owner's state, so running it once the owner is gone is precisely the
//     leak this file exists to prevent.
//
// Delivered teardown runs; late effects do not.

// One name, one live timer: scheduling a live name releases the previous timer
// first, so a fast re-schedule cannot leave two pending callbacks behind.
//
// After dispose, scheduling is DROPPED — not run. Every timer here is an effect
// on its owner's state, and an owner that was torn down must not have its
// effects fire afterwards; that is the leak this file exists to prevent. A late
// `clear` or `dispose` is a no-op, so a shared teardown path cannot
// double-release.

/** One arm-able timer: the id and how to release it. */
type TimerHandle =
  | { readonly kind: "timeout"; readonly id: ReturnType<typeof setTimeout> }
  | { readonly kind: "interval"; readonly id: ReturnType<typeof setInterval> }
  | { readonly kind: "raf"; readonly id: number };

/** Release a handle whatever kind it is. */
const cancel = (handle: TimerHandle): void => {
  if (handle.kind === "timeout") clearTimeout(handle.id);
  else if (handle.kind === "interval") clearInterval(handle.id);
  else cancelAnimationFrame(handle.id);
};

/** Create an empty timer owner. One per teardown owner (a LayerUI, a manager). */
const createTimers = (): Timers => {
  const live = new Map<string, TimerHandle>();
  let disposed = false;

  /** Drop one live timer. No-op for a name that is not scheduled. */
  const release = (name: string): void => {
    const handle = live.get(name);
    if (!handle) return;
    live.delete(name);
    cancel(handle);
  };

  /** One entry point for every arm: release the previous timer, then arm. */
  const schedule = (name: string, arm: () => TimerHandle): void => {
    if (disposed) return;
    release(name);
    live.set(name, arm());
  };

  return {
    get disposed() {
      return disposed;
    },
    timeout(name, fn, ms) {
      schedule(name, () => ({
        kind: "timeout",
        id: setTimeout(() => {
          // Leave the map first: a re-schedule from inside the callback must
          // not be cancelled by the callback's own release.
          live.delete(name);
          fn();
        }, ms),
      }));
    },
    interval(name, fn, ms) {
      schedule(name, () => ({ kind: "interval", id: setInterval(fn, ms) }));
    },
    raf(name, fn) {
      schedule(name, () => ({
        kind: "raf",
        id: requestAnimationFrame(time => {
          live.delete(name);
          fn(time);
        }),
      }));
    },
    clear(name) {
      release(name);
    },
    names() {
      return [...live.keys()];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const handle of live.values()) cancel(handle);
      live.clear();
    },
  };
};

export { createTimers };
