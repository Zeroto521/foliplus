// CSS custom property reader for foliplus components.
// Imported statically by components at build time.

/**
 * Read a CSS custom property value from a container element.
 * Falls back to the provided default if the property is not set or empty.
 * @param el - Element to query computed styles from
 * @param prop - CSS custom property name, e.g. "--heatmap-label-color"
 * @param fallback - Fallback value if property is not defined
 */
const cssVar = (el: HTMLElement, prop: string, fallback = ""): string => {
  return getComputedStyle(el).getPropertyValue(prop).trim() || fallback;
};

export { cssVar };
