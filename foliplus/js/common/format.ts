// Number formatting for foliplus components.
// Imported statically by components at build time.

type NumberStyle = "auto" | "comma" | "int";

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
  fractionDigits: number = 1,
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

  // int: plain integer, no grouping separator (6000) — distinct from comma's
  // thousands separator (6,000). Both are locale-agnostic.
  if (style === "int")
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: 0,
      useGrouping: false,
    }).format(val);

  // auto: compact notation for large values, with fractional digits trimmed
  // once the integer part reaches 3 digits. Compact notation already renders
  // below its unit boundary without a grouping separator — zh < 10000 has no
  // 万 unit, so 6000 comes out as "6000", not "6,000", which is exactly right
  // for zh/ja 4-digit grouping. No special fallback is needed.
  const nf = fmt(1);
  const intStr = nf
    .formatToParts(val)
    .filter(p => p.type === "integer")
    .map(p => p.value)
    .join("");
  return intStr.length >= 3 ? fmt(0).format(val) : nf.format(val);
};

/** Coordinate precision shared by every location readout. Kept here rather
 *  than duplicated in each component: an uncoordinated change to either side
 *  makes the same point display differently in two places. */
const LAT_LNG_PRECISION = 6;

/** One coordinate for a location readout: fixed decimals, en grouping,
 *  language-agnostic — the operator reads the number itself, not the locale. */
const formatCoord = (n: number, digits = LAT_LNG_PRECISION): string =>
  formatNumber(n, "comma", "en", digits);

/** An lng/lat pair as the readout string, longitude leading. */
const formatLatLng = (
  lng: number,
  lat: number,
  digits = LAT_LNG_PRECISION,
): string => `${formatCoord(lng, digits)}, ${formatCoord(lat, digits)}`;

export { type NumberStyle, formatNumber, LAT_LNG_PRECISION, formatCoord, formatLatLng };
