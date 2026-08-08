/**
 * Get the active locale table from the global namespace.
 * Reads `window._LOCALE` set by the runtime (runtime.locale.js).
 * @returns {Object|undefined} The locale table, or undefined if not set.
 */
const getLocale = () => window._LOCALE;

/**
 * Get the locale code (e.g. "en" or "zh").
 * Defaults to "en" when the table is unavailable.
 * @returns {string} Language code.
 */
const getLocaleCode = () => {
  const loc = getLocale();
  return (loc && loc["locale.code"]) || "en";
};

export { getLocale, getLocaleCode };
