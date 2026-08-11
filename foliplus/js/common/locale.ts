// Locale resolution for the foliplus runtime.
//
// Detects the browser language and selects a locale table from the ones
// injected per-component. Used when a control's locale code is not fixed
// by the user.

type LocaleTables = Record<string, Record<string, string>>;

/**
 * Resolve the active locale table by checking (in order):
 * explicit code, parent iframe path, referrer URL, document URL path,
 * HTML lang attribute, and browser language. Defaults to `tables['en']`.
 */
const resolveLocale = (
  code: string,
  tables: LocaleTables | null,
): Record<string, string> | null => {
  if (!tables) return null;
  let lang = "";

  // 1. Explicit code from Python (Highest priority if provided)
  if (code && tables[code]) lang = code;

  // 2. Detect from parent context if inside an iframe
  if (!lang) {
    try {
      const parentWin = window.parent;
      if (parentWin && parentWin !== window) {
        const parentPath = parentWin.location.pathname;
        const m = parentPath.match(/\/(en|zh)\//i);
        if (m) lang = m[1].toLowerCase();

        if (!lang) {
          let pLang = parentWin.document.documentElement.lang || "";
          if (pLang) {
            pLang = pLang.split("-")[0].split("_")[0].toLowerCase();
            if (tables[pLang]) lang = pLang;
          }
        }
      }
    } catch (e) {
      // Ignore cross-origin iframe security restrictions
    }
  }

  // 3. Detect from embedding referrer URL
  if (!lang && typeof document !== "undefined" && document.referrer) {
    const m = document.referrer.match(/\/(en|zh)\//i);
    if (m && tables[m[1].toLowerCase()]) lang = m[1].toLowerCase();
  }

  // 4. Detect from current window URL path
  if (!lang) {
    const path = window.location.pathname;
    const m = path.match(/\/(en|zh)\//i);
    if (m && tables[m[1].toLowerCase()]) lang = m[1].toLowerCase();
  }

  // 5. HTML lang attribute
  if (!lang || !tables[lang]) {
    let htmlLang = document.documentElement.lang || "";
    if (htmlLang) {
      htmlLang = htmlLang.split("-")[0].split("_")[0].toLowerCase();
      if (tables[htmlLang]) lang = htmlLang;
    }
  }

  // 6. Browser language
  if (!lang || !tables[lang]) {
    lang = (
      typeof navigator !== "undefined"
        ? navigator.language || (navigator as any).userLanguage || ""
        : ""
    )
      .split("-")[0]
      .split("_")[0]
      .toLowerCase();
  }

  return tables[lang] || tables["en"];
};

/**
 * Resolve the active locale code from a component's CONF.
 * Uses explicit code when provided, otherwise auto-detects via URL/HTML/browser.
 * Mutates ``conf.locale_code`` with the resolved code so subsequent calls
 * short-circuit without repeating the detection.
 */
const resolveLocaleCode = (conf: any): string => {
  if (conf.locale_code) return conf.locale_code;
  const table = resolveLocale("", conf.locale_tables);
  conf.locale_code = (table && table["locale.code"]) || "en";
  return conf.locale_code;
};

/**
 * Create a translator function for a component.
 * Merges common tables (``window.foliplus._TABLES``) with component-specific
 * tables (``conf.locale_tables``) and resolves the active language.
 */
const createTranslator = (conf: any): ((key: string) => string) => {
  const code = resolveLocaleCode(conf);

  // Merge common + component tables
  const common = (window.foliplus._TABLES || {})[code] || {};
  const own = (conf.locale_tables || {})[code] || {};
  const table = { ...common, ...own };
  table["locale.code"] = code;

  return k => (table[k] !== undefined ? table[k] : k);
};

export { createTranslator };
