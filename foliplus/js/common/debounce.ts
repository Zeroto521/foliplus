// Debounce utility for foliplus components.
// Imported statically by components at build time.
import type { Debounced } from "./type.js";

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
export type { Debounced } from "./type.js";
