// Debounce utility for foliplus components.
// Imported statically by components at build time.

/**
 * Shared debounce utility. Returns a debounced version of `func` that
 * delays invocation until `delayMs` ms after the last call.
 * The returned function has a `.cancel()` method to clear pending timers.
 */
type Debounced = ((...args: unknown[]) => void) & {
  cancel: () => void;
  flush: () => void;
};

const debounce = (func: (...args: unknown[]) => void, delayMs: number): Debounced => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: unknown[]) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      func(...args);
    }, delayMs);
  };
  debounced.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  debounced.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      func();
    }
  };
  return debounced;
};

export { type Debounced, debounce };
