// Self-scheduling animation frame loop — repeatedly run a tick at ~60Hz
// until stopped. Used for keyboard-driven continuous movement (e.g. holding
// an arrow key) where each OS keydown event is too coarse and irregular to
// drive motion directly.
//
// Driven by setTimeout (one per frame) rather than requestAnimationFrame so
// that the loop can be driven deterministically in tests: vitest's
// useFakeTimers() advances the inner timer, and headless browser tests can
// wait for the final loop's frame to settle after rapid repeated keydowns.

type Handle = unknown;
type Scheduler = (fn: () => void, ms: number) => Handle;

export type RafLoop = {
  start(key?: string): void;
  stop(): void;
  cancel(): void;
};

/**
 * Create a self-scheduling loop.
 *
 * - `tick` is called each scheduled frame while the loop is running;
 *   returning truthy stops it (e.g. a guard detects a locked/removed box).
 *   The key, if any, is passed through so the tick can branch on direction.
 * - `scheduler` defaults to setTimeout, so ticks fire once per frame in
 *   production; inject a no-op or vi-advancable scheduler in tests.
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
      clearTimeout(pending as ReturnType<typeof setTimeout>);
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
      // for the first timer tick (~16ms) that would make the first step
      // feel delayed.
      if (tick(key)) return stop();
      schedule();
    },
    stop,
    cancel() {
      if (pending) {
        clearTimeout(pending as ReturnType<typeof setTimeout>);
        pending = null;
      }
    },
  };
};

export { rafLoop };
