// Debounce utility for foliplus components.
// Imported statically by components at build time.

/**
 * What `debounce()` returns: a debounced copy of `func` that fires only after
 * `delayMs` ms have passed with no further call, plus two handles on the
 * pending call.
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

export { debounce };
export type { Debounced };
