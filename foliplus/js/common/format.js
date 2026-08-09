// Number formatting for foliplus components.
// Imported statically by components at build time (谁用谁 import).

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

export { formatNumber };
