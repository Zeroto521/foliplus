// Number formatting for foliplus components.
// Imported statically by components at build time.

export type NumberStyle = "auto" | "comma" | "int";

/**
 * Format a number for display.
 * @param val Value to format
 * @param style 'auto' (compact: 1.2K/1.2W/1.2M),
 *              'comma' or 'int' (user-requested thousands separator)
 * @param locale Locale code, defaults to 'en'
 */
const formatNumber = (
  val: number,
  style: NumberStyle = "auto",
  locale = "en",
): string => {
  const absVal = Math.abs(val);

  const fmt = (maxFrac: number) =>
    new Intl.NumberFormat(locale, {
      notation: style === "auto" && absVal >= 1000 ? "compact" : "standard",
      compactDisplay: "short",
      maximumFractionDigits: maxFrac,
    });

  if (style === "auto") {
    const nf = fmt(1);
    const parts = nf.formatToParts(val);
    const intStr = parts
      .filter(p => p.type === "integer")
      .map(p => p.value)
      .join("");

    // Compact notation formats below its unit boundary (e.g. zh < 10000 has
    // no 万 unit) without a grouping separator, which is exactly right for
    // those locales (6000, not 6,000). So no special fallback is needed —
    // just round to 0 fraction digits when the integer part is >= 3 digits.
    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  // comma/int are user-explicit — always keep grouping (千分位) regardless
  // of locale.
  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
