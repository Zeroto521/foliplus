// Utility helpers for the foliplus runtime.
//
// Number formatting, debounce, storage, and CSS variable helpers.

/**
 * Format a number for display.
 * @param {number} val Value to format
 * @param {string} [style='auto'] 'auto' (compact: 1.2K/1.2W/1.2M),
 *                                'comma' or 'int' (thousands separator: 1,234.6)
 * @param {string} [locale] Locale code, defaults to browser language (en/zh)
 * @returns {string} Formatted string
 */
const formatNumber = (val, style, locale = "en") => {
  style = style || "auto";
  const absVal = Math.abs(val);

  const fmt = (maxFrac) =>
    new Intl.NumberFormat(locale, {
      notation: style === "auto" && absVal >= 1000 ? "compact" : "standard",
      compactDisplay: "short",
      maximumFractionDigits: maxFrac,
    });

  if (style === "auto") {
    const nf = fmt(1);
    const parts = nf.formatToParts(val);
    const intStr = parts
      .filter((p) => p.type === "integer")
      .map((p) => p.value)
      .join("");
    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

/**
 * Shared debounce utility. Returns a debounced version of `fn` that
 * delays invocation until `delayMs` ms after the last call.
 * The returned function has a `.cancel()` method to clear pending timers.
 *
 * @param {function} fn      - The function to debounce.
 * @param {number}   delayMs - Delay in milliseconds.
 * @returns {function} Debounced function with `.cancel()`.
 */
const debounce = (fn, delayMs) => {
  let timer = null;
  const debounced = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
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
      fn();
    }
  };
  return debounced;
};

/**
 * Read a CSS custom property value from a container element.
 * Falls back to the provided default if the property is not set or empty.
 * @param {HTMLElement} el - Element to query computed styles from
 * @param {string} prop - CSS custom property name, e.g. "--heatmap-label-color"
 * @param {string} [fallback] - Fallback value if property is not defined
 * @returns {string} Trimmed property value or fallback
 */
const cssVar = (el, prop, fallback = "") => {
  return getComputedStyle(el).getPropertyValue(prop).trim() || fallback;
};

/**
 * Shared localStorage helper for all foliplus controls.
 * Wraps JSON read/write in try/catch so failures never break map init.
 */
const storage = {
  /**
   * Read and parse a value from localStorage.
   * @param {string} key    - localStorage key.
   * @param {string} [name] - Caller component name, used as the log prefix.
   * @returns {*} Parsed value, or null when missing/unreadable.
   */
  load(key, name) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      console.warn(`[${name || "foliplus"}] Failed to load saved data (key=${key})`, e);
      return null;
    }
  },

  /**
   * Serialize and write a value to localStorage.
   * @param {string} key    - localStorage key.
   * @param {*} data        - Value to persist (must be JSON-serializable).
   * @param {string} [name] - Caller component name, used as the log prefix.
   */
  save(key, data, name) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (e) {
      console.warn(`[${name || "foliplus"}] Failed to save data (key=${key})`, e);
    }
  },
};

export { cssVar, debounce, formatNumber, storage };
