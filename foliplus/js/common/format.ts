// Number formatting for foliplus components.
// Imported statically by components at build time.

export type NumberStyle = "auto" | "comma" | "int";

/**
 * Format a number for display.
 * @param val Value to format
 * @param style 'auto' (compact: 1.2K/1.2W/1.2M),
 *              'comma' or 'int' (thousands separator: 1,234.6)
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
    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
