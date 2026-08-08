// Locale resolution for the foliplus runtime.
//
// Detects the browser language and selects a locale table from the ones
// injected per-component. Used when a control's locale code is not fixed
// by the user.

/**
 * Resolve the active locale table by checking (in order):
 * explicit code, parent iframe path, referrer URL, document URL path,
 * HTML lang attribute, and browser language. Defaults to `tables['en']`.
 *
 * @param {string} code   - Locale code from Python ('' for auto-detect)
 * @param {Object} tables - Map of locale code → translation table
 * @returns {Object} The selected locale table.
 */
const resolveLocale = (code, tables) => {
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
        ? navigator.language || navigator.userLanguage || ""
        : ""
    )
      .split("-")[0]
      .split("_")[0]
      .toLowerCase();
  }

  return tables[lang] || tables["en"];
};

export { resolveLocale };
