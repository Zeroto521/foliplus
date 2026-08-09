// Debounce utility for foliplus components.
// Imported statically by components at build time (谁用谁 import).

/**
 * Shared debounce utility. Returns a debounced version of `func` that
 * delays invocation until `delayMs` ms after the last call.
 * The returned function has a `.cancel()` method to clear pending timers.
 *
 * @param {function} func      - The function to debounce.
 * @param {number}   delayMs - Delay in milliseconds.
 * @returns {function} Debounced function with `.cancel()`.
 */
const debounce = (func, delayMs) => {
  let timer = null;
  const debounced = (...args) => {
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
