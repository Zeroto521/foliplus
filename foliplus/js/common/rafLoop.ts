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
};

const FRAME = 16;

/**
 * Create a self-scheduling loop.
 *
 * - `tick` is called each scheduled frame while the loop is running;
 *   returning truthy stops it (e.g. a guard detects a locked/removed box).
 *   The key, if any, is passed through so the tick can branch on direction.
 * - `scheduler` defaults to setTimeout, so ticks fire once per frame in
 *   production; inject a no-op or vi-advancable scheduler in tests.
 * - `ramp` sets the delay for the *first scheduled frame* only (after the
 *   sync first frame). Subsequent frames use `FRAME` (16ms). Use a ramp so
 *   a brief tap produces only the sync frame (one step) while a held key
 *   ramps into a smooth ~60Hz stream — matching OS key-repeat feel without
 *   a runaway step on every tap.
 *
 * @param tick  per-frame callback; returning truthy stops the loop.
 * @param options injectable timer for test determinism and ramp control.
 */
const rafLoop = (
  tick: (key?: string) => void | boolean,
  { scheduler = setTimeout, ramp = 0 }: { scheduler?: Scheduler; ramp?: number } = {},
): RafLoop => {
  let running = false;
  let key: string | undefined;
  let pending: Handle | null = null;
  let firstFrame = false;

  const stop = () => {
    running = false;
    if (pending) {
      clearTimeout(pending as ReturnType<typeof setTimeout>);
      pending = null;
    }
  };

  const schedule = (initialDelay?: number) => {
    pending = scheduler(() => {
      pending = null;
      if (!running) return;
      if (tick(key)) return stop();
      if (running) schedule();
    }, initialDelay ?? FRAME);
  };

  return {
    start(newKey?: string) {
      if (newKey) key = newKey;
      if (running) return;
      running = true;
      firstFrame = true;
      // Synchronous first frame: immediate response to the press, no wait
      // for the first timer tick (~16ms) that would make the first step
      // feel delayed.
      if (tick(key)) return stop();
      // Apply the ramp to the first scheduled frame only — a tap (<ramp ms)
      // yields only the sync step; a hold ramps into the 60Hz stream.
      if (firstFrame && ramp > 0) {
        firstFrame = false;
        schedule(ramp);
      } else {
        schedule();
      }
    },
    stop,
  };
};

export { rafLoop };
