// CSS custom property reader for foliplus components.
// Imported statically by components at build time (谁用谁 import).

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

export { cssVar };
