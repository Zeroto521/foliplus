// Number formatting for foliplus components.
// Imported statically by components at build time.

export type NumberStyle = "auto" | "comma" | "int";

/**
 * Grouping unit of the locale, in digits.
 * zh/CJK = 4 (万/亿); most other locales = 3 (thousands).
 */
const GROUP_SIZE: Record<string, number> = {
  zh: 4,
  ja: 3,
  ko: 3,
};

/**
 * Return the grouping size for a locale code, falling back to 3.
 * Accepts 'zh-CN', 'zh', 'zh-Hans', 'en', etc.
 */
const groupSize = (locale: string): number => {
  const base = locale.split("-")[0].split("_")[0].toLowerCase();
  return GROUP_SIZE[base] ?? 3;
};

/** CJK locales (grouping size 4) — zh. ja/ko stay at 3. */
const isCJKLocale = (locale: string): boolean => groupSize(locale) === 4;

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

    // Compact notation produced no compact unit part — this happens for
    // zh (CJK, 4-digit 万 unit) when value < 10000. Fall back to standard
    // formatting. For CJK locales the grouping unit is 4 digits, so a
    // sub-10000 integer needs no separator (6000, not 6,000); disable
    // grouping for those locales and keep native grouping for others.
    if (!parts.some(p => p.type === "compact"))
      return new Intl.NumberFormat(locale, {
        maximumFractionDigits: 0,
        useGrouping: !isCJKLocale(locale),
      }).format(val);

    if (intStr.length >= 3) return fmt(0).format(val);

    return nf.format(val);
  }

  // comma/int are user-explicit — always keep grouping (千分位) regardless
  // of locale.
  return fmt(absVal >= 100 ? 0 : 1).format(val);
};

export { formatNumber };
