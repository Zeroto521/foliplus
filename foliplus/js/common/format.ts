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

    // Compact notation produced no compact unit part. For en this is only
    // values < 1000 (100/500/999 — no separator needed); for zh it covers
    // < 10000 (the 万 unit begins at 10000), so 6000 reaches here instead
    // of compact. Either way the value is below its grouping boundary, so
    // disable grouping to get 6000 rather than 6,000.
    if (!parts.some(p => p.type === "compact"))
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
        useGrouping: false,
      }).format(val);

    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  // comma/int are user-explicit — always keep grouping (千分位) regardless
  // of locale.
  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
