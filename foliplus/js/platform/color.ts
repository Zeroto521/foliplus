// platform/color — the single home for color parse/compose/normalize primitives.
// Every consumer imports from here; a second copy of the hex/rgba regex is a
// drift the guard test catches (see test/js/platform/color.test.ts).

/** Expand #rgb to #rrggbb so <input type=color> accepts Python's "#fff".
 *  Values that are not a 3-digit hex pass through unchanged. */
const normalizeHexColor = (value: string): string => {
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return value;
};

/** True when the value is a 3- or 6-digit hex string — the only shape the
 *  persisted record accepts (a corrupt entry cannot leak into the panel). */
const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value);

/** Parse a CSS color string into its hex + alpha-percent pair.
 *
 *  Accepts #rgb, #rrggbb, rgb(r, g, b) and rgba(r, g, b, a). The browser
 *  normalizes style.color to the rgb/rgba forms with a as a 0-1 float; a
 *  missing alpha means 100 (opaque). Returns null for a value we cannot turn
 *  into a hex+alpha pair — a named color, a CSS variable, an empty string —
 *  so the caller keeps the raw string and treats it as opaque (honest: the
 *  author painted a name the derive must not re-invent). */
const parseColorAlpha = (css: string): { hex: string; alpha: number } | null => {
  const value = css.trim();
  if (value === "") return null;
  let m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(value);
  if (m) {
    let hex = value;
    if (m[1].length === 3) {
      const [r, g, b] = m[1];
      hex = `#${r}${r}${g}${g}${b}${b}`;
    }
    return { hex: hex.toLowerCase(), alpha: 100 };
  }
  // The browser normalizes style.color to rgb(r, g, b) / rgba(r, g, b, a)
  // with a as a 0-1 float. Parse both; a missing alpha is opaque.
  m =
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(
      value,
    );
  if (m) {
    const toHex = (n: number): string =>
      Math.max(0, Math.min(255, Math.round(n)))
        .toString(16)
        .padStart(2, "0");
    // m[1..3] are the channels and
    // m[4] is the optional alpha (a missing alpha is opaque).
    const hex = `#${toHex(Number(m[1]))}${toHex(Number(m[2]))}${toHex(Number(m[3]))}`;
    const alpha = m[4] !== undefined ? Math.round(Number(m[4]) * 100) : 100;
    return { hex, alpha };
  }
  return null;
};

/** Compose a hex color plus an alpha percent into one CSS color string.
 *  Alpha 100 is the hex itself (no rgba noise); below 100 it is the
 *  rgba(r, g, b, a) form, so the glyph carries one color string and the
 *  alpha rides it — the single compose point for the color+opacity pair. */
const composeColorAlpha = (hex: string, alpha: number): string => {
  const a = Math.round(alpha);
  if (a >= 100) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${a / 100})`;
};

export { composeColorAlpha, isHexColor, normalizeHexColor, parseColorAlpha };
