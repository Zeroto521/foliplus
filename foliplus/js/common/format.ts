// Number formatting for foliplus components.
// Imported statically by components at build time.

export type NumberStyle = "auto" | "comma" | "int";

/**
 * Format a number for display.
 * @param val Value to format
 * @param style 'auto' (compact: en 1.2K, zh 1.2万 — locale-native units),
 *              'comma' (thousands separator: 6,000),
 *              'int' (plain integer, no grouping: 6000)
 * @param locale Locale code for 'auto'/'int', defaults to 'en'. Never
 *               consulted by 'comma', which always groups en-style.
 * @param fractionDigits Fixed fraction digits, 'comma' only (default 1). Min
 *               and max are pinned together, so decimals stay fixed rather
 *               than trailing-digit-trimmed (1.0, not 1; 2.50, not 2.5). Pass
 *               0 for whole numbers to drop the ".0".
 */
const formatNumber = (
  val: number,
  style: NumberStyle = "auto",
  locale: string = "en",
  fractionDigits = 1,
): string => {
  // 'comma' is language-agnostic: always en grouping, fixed fraction digits.
  if (style === "comma")
    return new Intl.NumberFormat("en", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(val);

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

    // Compact notation already renders below its unit boundary without a
    // grouping separator — zh < 10000 has no 万 unit, so 6000 comes out
    // as "6000", not "6,000", which is exactly right for zh/ja 4-digit
    // grouping. No special fallback is needed; just trim fractional digits
    // once the integer part reaches 3 digits.
    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  // int: plain integer, no grouping separator (6000) — distinct from comma's
  // thousands separator (6,000). Both are locale-agnostic.
  if (style === "int")
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      useGrouping: false,
    }).format(val);

  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
