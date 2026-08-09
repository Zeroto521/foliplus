/**
 * Resolve the active locale code from a component's CONF.
 * Uses explicit code when provided, otherwise auto-detects via URL/HTML/browser.
 * Mutates ``conf.locale_code`` with the resolved code so subsequent calls
 * short-circuit without repeating the detection.
 *
 * @param {Object} conf - The component's ``CONF`` object.
 * @returns {string} Resolved locale code (e.g. "en" or "zh").
 */
const resolveLocaleCode = (conf) => {
  if (conf.locale_code) return conf.locale_code;
  // Auto-detect from browser/URL — only used when locale_code is empty
  if (window.foliplus && window.foliplus.resolveLocale) {
    const table = window.foliplus.resolveLocale("", conf.locale_tables);
    conf.locale_code = (table && table["locale.code"]) || "en";
  }
  return conf.locale_code;
};

/**
 * Create a translator function for a component.
 * Merges common tables (``window.foliplus._TABLES``) with component-specific
 * tables (``conf.locale_tables``) and resolves the active language.
 *
 * @param {Object} conf - The component's ``CONF`` object.
 * @returns {Function} Translator function ``_(key) => string``.
 */
const createTranslator = (conf) => {
  const code = resolveLocaleCode(conf);

  // Merge common + component tables
  const common = (window.foliplus._TABLES || {})[code] || {};
  const own = (conf.locale_tables || {})[code] || {};
  const table = { ...common, ...own };
  table["locale.code"] = code;

  return (k) => (table[k] !== undefined ? table[k] : k);
};

export { createTranslator, resolveLocaleCode };
