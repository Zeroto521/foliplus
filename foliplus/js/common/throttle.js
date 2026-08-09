// RAF throttling helper — run a function at most once per animation frame.
// Imported statically by components (谁用谁 import). Replaces the repeated
// inline requestAnimationFrame/cancelAnimationFrame bookkeeping (e.g.
// bindMapSync's move handler, LayerControl's managed canvas position).

/**
 * Throttle a function to at most one invocation per animation frame.
 * Calls within a frame are coalesced; the last one runs on the next frame.
 * Returns the wrapped function with a `cancel()` method to drop a pending frame.
 * @param {Function} fn - Function to throttle.
 * @returns {Function & { cancel: () => void }} Throttled wrapper.
 */
const throttleRaf = (fn) => {
  let rafId = null;
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

export { throttleRaf };
