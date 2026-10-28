// The author's original colors as one order and one CSS gradient.
//
// The read-only "Original colors" arm states what the layer's author painted.
// Two problems live here, and neither is a styling knob:
//
//   Order. A paired branca scale ships its colors in domain order (a stepped
//   scale's own blocks, or samples of a continuous ramp), so those are used
//   exactly as shipped. A categorical layer (no scale, `legend=False`) ships
//   its distinct colors in feature-discovery order, which is arbitrary: the
//   same layer painted a different confetti order on every render. Those are
//   sorted hue → lightness, so the gradient is a stable function of the color
//   set rather than of the feature order.
//
//   Shape. Sixty-four `flex: none` blocks in a row were both the overflow and
//   the "no order" complaint; one `linear-gradient` cannot overflow and reads
//   as a ramp. A stepped scale keeps its bands by pinning each color between
//   two positions, so a class boundary stays a hard edge.
//
// Colors are kept verbatim — an explore layer's `missing_kwds` can put a CSS
// keyword such as `lightgrey` among hex stops, and rewriting it to a hex we
// guessed would paint something the author did not declare.

/** How many stops the bar keeps at most. A control-width bar cannot resolve
 *  more, and a 64-stop style attribute is a kilobyte of inline CSS for the
 *  same pixels. */
const MAX_STOPS = 12;

/** The slice of an author scale the bar's shape depends on. */
type OriginalScale = { kind?: string } | null | undefined;

type Rgb = [number, number, number];

/** `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` and `rgb()` / `rgba()`.
 *  A CSS keyword, a named color or an unknown function is not parsed: it is
 *  still a real color, only one this module cannot rank by hue. */
const toRgb = (color: string): Rgb | null => {
  const value = color.trim().toLowerCase();
  if (value.startsWith("#")) {
    const raw = value.slice(1);
    if (!/^[0-9a-f]+$/.test(raw) || ![3, 4, 6, 8].includes(raw.length)) {
      return null;
    }
    // Short forms repeat each digit (rgb), long forms pair them up; the
    // length check above guarantees an even split and a full set of pairs.
    const chunks =
      raw.length <= 4
        ? [...raw].map(ch => ch + ch)
        : Array.from({ length: raw.length / 2 }, (_, at) =>
            raw.slice(at * 2, at * 2 + 2),
          );
    return chunks.slice(0, 3).map(chunk => parseInt(chunk, 16)) as Rgb;
  }
  const call = /^rgba?\(([^)]*)\)$/.exec(value);
  if (!call) return null;
  const parts = call[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const channels = parts.slice(0, 3).map(part => {
    const number = Number.parseFloat(part);
    return part.endsWith("%") ? (number * 255) / 100 : number;
  });
  if (channels.some(channel => !Number.isFinite(channel))) return null;
  return channels.map(channel => Math.max(0, Math.min(255, channel))) as Rgb;
};

/** Hue (degrees) and lightness (0..1) — the two axes the categorical order
 *  uses. Saturation is deliberately not an axis: a gray has no hue to speak
 *  of, and ranking it by saturation would scatter it through the ramp. */
const toHueLightness = ([r, g, b]: Rgb): { hue: number; lightness: number } => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { hue: 0, lightness };
  const raw =
    max === red
      ? ((green - blue) / delta) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return { hue: (raw * 60 + 360) % 360, lightness };
};

/** Drop repeats but keep the first position of each color: a continuous scale
 *  sampled twice at the same value, or a categorical set that repeats a
 *  color, must not paint the same stop twice. */
const dedupe = (colors: readonly string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const color of colors) {
    const text = color.trim();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    unique.push(text);
  }
  return unique;
};

/** Hue → lightness, then the color string itself: a total order, so two
 *  renders of the same set cannot disagree. A color that does not parse (a
 *  CSS keyword) ranks after every parsed one, by name. */
const categorical = (colors: readonly string[]): string[] => {
  const rank = (color: string): [number, number, string] => {
    const rgb = toRgb(color);
    if (rgb === null) return [Number.POSITIVE_INFINITY, 0, color];
    const { hue, lightness } = toHueLightness(rgb);
    return [hue, lightness, color];
  };
  return [...colors].sort((a, b) => {
    const left = rank(a);
    const right = rank(b);
    if (left[0] !== right[0]) return left[0] - right[0];
    if (left[1] !== right[1]) return left[1] - right[1];
    return left[2] < right[2] ? -1 : left[2] > right[2] ? 1 : 0;
  });
};

/** Evenly spaced picks, both ends included and never the same index twice. */
const sample = (colors: readonly string[], limit: number): string[] => {
  if (colors.length <= limit) return [...colors];
  const last = colors.length - 1;
  return Array.from({ length: limit }, (_, index) => {
    return colors[Math.round((index * last) / (limit - 1))];
  });
};

const percent = (value: number): string => `${value.toFixed(2)}%`;

/** Hard bands: each color owns an equal slice of the bar. */
const bands = (colors: readonly string[]): string => {
  const step = 100 / colors.length;
  const stops = colors.map((color, index) => {
    return `${color} ${percent(index * step)} ${percent((index + 1) * step)}`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
};

/** Smooth ramp: colors at even positions, both ends pinned. */
const ramp = (colors: readonly string[]): string => {
  const last = colors.length - 1;
  const stops = colors.map((color, index) => {
    return `${color} ${percent((index / last) * 100)}`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
};

/** The bar's `background` value for an author record.
 *
 *  With a scale: the author's own order, shaped by its kind (a stepped scale
 *  keeps its bands, a continuous one stays smooth). Without one: the colors
 *  ranked hue → lightness and sampled down, so a 64-color categorical layer
 *  paints one ordered gradient instead of a confetti strip. Fewer than two
 *  colors cannot make a gradient, so that case paints the single color. */
const originalGradient = (stops: readonly string[], scale?: OriginalScale): string => {
  const colors = dedupe(stops);
  if (colors.length === 0) return "";
  if (colors.length === 1) return colors[0];
  if (scale != null) {
    const sampled = sample(colors, MAX_STOPS);
    return scale.kind === "stepped" ? bands(sampled) : ramp(sampled);
  }
  return ramp(sample(categorical(colors), MAX_STOPS));
};

export { MAX_STOPS, originalGradient };
