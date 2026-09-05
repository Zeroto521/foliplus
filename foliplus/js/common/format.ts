// Number formatting for foliplus components.
// Imported statically by components at build time.

export type NumberStyle = "auto" | "comma" | "int";

/**
 * Format a number for display.
 * @param val Value to format
 * @param style 'auto' (compact: en 1.2K, zh 1.2万 — locale-native units),
 *              'comma' (thousands separator: 6,000),
 *              'int' (plain integer, no grouping: 6000)
 * @param locale Locale code for 'auto'/'int', or a fraction-digit count for
 *               'comma' (defaults to 1). 'comma' ignores it and always groups
 *               en-style, which is what keeps decimals alongside grouping:
 *               1,234.5 km, 1.23 km². Pass 0 explicitly for whole-number
 *               'comma' values (a count of 0 groups too, but drops the
 *               trailing ".0" the default adds).
 */
const formatNumber = (
  val: number,
  style: NumberStyle = "auto",
  locale: string | number = "en",
): string => {
  // 'comma' is language-agnostic: always en grouping, fixed fraction digits.
  if (style === "comma") {
    const frac = typeof locale === "number" ? locale : 1;
    return new Intl.NumberFormat("en", {
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    }).format(val);
  }

  // 'auto'/'int' read the locale as a locale code only.
  const localeCode = typeof locale === "number" ? "en" : locale;
  const absVal = Math.abs(val);

  const fmt = (maxFrac: number) =>
    new Intl.NumberFormat(localeCode, {
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

    // Compact notation already renders below its unit boundary without a
    // grouping separator — zh < 10000 has no 万 unit, so 6000 comes out
    // as "6000", not "6,000", which is exactly right for zh/ja 4-digit
    // grouping. No special fallback is needed; just trim fractional digits
    // once the integer part reaches 3 digits.
    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  // int: plain integer, no grouping separator (6000) — distinct from comma's
  // thousands separator (6,000).
  if (style === "int")
    return new Intl.NumberFormat(localeCode, {
      maximumFractionDigits: 0,
      useGrouping: false,
    }).format(val);

  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
