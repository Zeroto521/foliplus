// RAF throttling helper — run a function at most once per animation frame.
// Imported statically by components. Replaces the repeated
// inline requestAnimationFrame/cancelAnimationFrame bookkeeping (e.g.
// bindMapSync's move handler, LayerControl's managed canvas position).

/**
 * Throttle a function to at most one invocation per animation frame.
 * Calls within a frame are coalesced; the last one runs on the next frame.
 * Returns the wrapped function with a `cancel()` method to drop a pending frame.
 */
const throttleRaf = (fn: () => void): (() => void) & { cancel: () => void } => {
  let rafId: number | null = null;
  const wrapped = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      fn();
    });
  };
  wrapped.cancel = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };
  return wrapped;
};

/**
 * Schedule a one-shot run on the next animation frame and return a cancel
 * function — call it on teardown to drop a frame that must not land. Unlike
 * {@link throttleRaf} there is no coalescing: each call schedules its own
 * frame, which is what a "after the layout settles" defer wants.
 */
const nextFrame = (fn: () => void): (() => void) => {
  const rafId = requestAnimationFrame(fn);
  return () => cancelAnimationFrame(rafId);
};

export { nextFrame, throttleRaf };
