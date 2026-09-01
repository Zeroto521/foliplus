// Self-scheduling animation frame loop — repeatedly run a tick at ~60Hz
// until stopped. Used for keyboard-driven continuous movement (e.g. holding
// an arrow key) where each OS keydown event is too coarse and irregular to
// drive motion directly.
//
// Driven by setTimeout (one per frame) rather than requestAnimationFrame so
// that the loop can be driven deterministically in tests: vitest's
// useFakeTimers() advances the inner timer, and headless browser tests can
// wait for the final loop's frame to settle after rapid repeated keydowns.

// The handle a scheduler returns — must be clearTimeout-compatible so stop()
// can cancel the pending frame. Injected schedulers (tests) already satisfy
// this by returning a number; no separate canceller needed.
type Handle = ReturnType<typeof setTimeout>;
type Scheduler = (fn: () => void, ms: number) => Handle;

export type RafLoop = {
  start(key?: string): void;
  stop(): void;
};

/**
 * Create a self-scheduling loop.
 *
 * - `tick` is called each scheduled frame while the loop is running;
 *   returning truthy stops it (e.g. a guard detects a locked/removed box).
 *   The key, if any, is passed through so the tick can branch on direction.
 * - `scheduler` defaults to setTimeout, so ticks fire once per frame in
 *   production; inject a no-op or vi-advancable scheduler in tests. The
 *   consumer controls cadence by wrapping setTimeout — e.g. a nudge loop
 *   passes setTimeout with a 50ms interval for ~20 steps/s rather than the
 *   default 16ms (~60/s), matching OS key-repeat feel.
 *
 * @param tick  per-frame callback; returning truthy stops the loop.
 * @param options injectable timer for test determinism.
 */
const rafLoop = (
  tick: (key?: string) => void | boolean,
  { scheduler = setTimeout }: { scheduler?: Scheduler } = {},
): RafLoop => {
  let running = false;
  let key: string | undefined;
  let pending: Handle | null = null;

  const stop = () => {
    running = false;
    if (pending) {
      clearTimeout(pending);
      pending = null;
    }
  };

  const schedule = () => {
    pending = scheduler(() => {
      pending = null;
      if (!running) return;
      if (tick(key)) return stop();
      if (running) schedule();
    }, 16);
  };

  return {
    start(newKey?: string) {
      if (newKey) key = newKey;
      if (running) return;
      running = true;
      // Synchronous first frame: immediate response to the press, no wait
      // for the first timer tick that would make the first step feel delayed.
      if (tick(key)) return stop();
      schedule();
    },
    stop,
  };
};

export { rafLoop };
