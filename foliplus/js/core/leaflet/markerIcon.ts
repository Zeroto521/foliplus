// core/leaflet — the Leaflet-facing side of the per-layer marker icon
// dimension (relocated from control/LayerControl/ui/style/icon.ts so the
// Leaflet adapter lives in core and the control layer keeps only DOM/panel).
//
// The icon dimension is a WHOLE-LAYER choice: the user picks one glyph from
// a grid, and every marker leaf in the layer gets that glyph. There is no
// field, no per-category mapping, no legend — one layer, one icon.
//
// The write is a direct Leaflet call rather than a `setStyle` face: a
// marker's icon is `options.icon`, not a style slice. This module holds the
// Leaflet-specific logic only — no DOM, no panel, no intent store. The
// control layer's icon.ts reads/writes the intent and FACE scheduling, then
// delegates the actual Leaflet walk here.
//
// The authored icon is captured, not cloned. `setIcon` mutates
// `options.icon`, so reading it back after a write would feed the leaf its
// own last write; the author's icon is captured once per leaf on the first
// write (a WeakMap keyed by leaf, so a re-rendering GeoJSON recaptures
// honestly) and is what Reset restores from. A leaf with no explicit icon
// falls back to `L.Icon.Default.prototype` (Leaflet's shared default), so
// Reset always has a target.
//
// The glyph swap uses the DERIVE approach (lead-verified): the author's
// icon object is the prototype of a derived object whose `createIcon` is
// overridden to swap only the inner <i> symbol. The chassis (sprite
// background / className / iconSize / shadow) is inherited verbatim — the
// marker keeps the author's exact look minus the symbol.
import {
  DEFAULT_GLYPH_PREFIX,
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
} from "./glyphSource.js";
import { presetNameOfHex } from "./markerColorPreset.js";
import { walkLeaf } from "#core/layer/walkLeaf.js";
import { detachMarkerIcons, mountedIconElement } from "#core/leafletAdapter.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("icon-dimension");
/** Glyph names already warned as unavailable — warn once per name, not per
 *  leaf walk. The CSS is static, so a second encounter of the same name is
 *  the same fact. */
const warnedGlyphs = new Set<string>();

/** Parse a CSS color into its hex form plus an alpha percent (0-100).
 *  Accepts the two shapes the derive path actually sees: a hex literal
 *  (#rgb / #rrggbb, the user intent and declared iconColor) and the
 *  normalized rgba()/rgb() form the browser writes to a style.color
 *  (the author's inner <i> inline paint). A missing alpha means 100 (opaque).
 *  Returns null for a value we cannot turn into a hex+alpha pair — a named
 *  color, a CSS variable, an empty string — so the caller keeps the raw
 *  string and treats it as opaque (honest: the author painted a name the
 *  derive must not re-invent). */
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
    // The regex now has no wrapping group: m[1..3] are the channels and
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

/** A captured awesome-markers chassis sprite: the URL plus the
 *  background-position offset of one preset cell. */
type ChassisSprite = { url: string; position: string };

/** The chassis sprite per preset name, read once from the live stylesheet
 *  (never hardcoded — the CDN URL is read, not written) or from an author
 *  div's inline style. Null-cached means "not readable here" (jsdom without a
 *  stylesheet and without an inline-styled fixture) — the caller falls back
 *  to the library class, which is always correct for a preset at alpha 100. */
const chassisSpriteCache = new Map<string, ChassisSprite | null>();

/** Read the sprite (URL + preset offset) for a preset name. Tries, in order:
 *  1. an author div's inline backgroundImage/backgroundPosition (jsdom
 *     fixtures and inline-styled authors);
 *  2. a probe div appended to the document with the preset class, reading
 *     the live stylesheet (the real browser path — the author's own div
 *     paints the sprite via a CSS class, so its inline style is empty, and a
 *     detached div has no computed style at all). */
const readChassisSprite = (
  presetName: string,
  fallbackDiv?: HTMLElement | null,
): ChassisSprite | null => {
  const cached = chassisSpriteCache.get(presetName);
  if (cached !== undefined) return cached;
  let url = "";
  let position = "";
  const inline = fallbackDiv?.style;
  if (inline?.backgroundImage && inline.backgroundImage !== "none") {
    url = inline.backgroundImage;
    position = inline.backgroundPosition || "0 0";
  }
  if (!url && typeof document !== "undefined" && document.body) {
    const probe = document.createElement("div");
    probe.className = `awesome-marker-icon-${presetName} awesome-marker`;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.left = "-9999px";
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe);
    url = computed.backgroundImage;
    position = computed.backgroundPosition || "0 0";
    document.body.removeChild(probe);
  }
  const sprite = /^url\(/.test(url) ? { url, position } : null;
  chassisSpriteCache.set(presetName, sprite);
  return sprite;
};

/** The leaf probe for the icon axis: a runtime `setIcon` (a marker). Same
 *  guard as the capability probe — a throwing getter answers nothing. */
const isIconLeaf = (leaf: unknown): leaf is L.Marker =>
  typeof (leaf as { setIcon?: unknown }).setIcon === "function";
/** The author's icon per leaf — captured on the layer's first write, and by
 *  reset time the only copy of it (`setIcon` replaces `options.icon` in
 *  place). Keyed by leaf so a tree that replaces its children (a
 *  re-rendering GeoJSON) recaptures honestly. */
const authorIcon = new WeakMap<object, unknown>();

/** Capture a leaf's author icon once. A leaf with no explicit icon falls
 *  back to `L.Icon.Default.prototype` so Reset always has a target. */
const captureAuthorIcon = (leaf: object): void => {
  if (authorIcon.has(leaf)) return;
  const own = (leaf as { options?: { icon?: unknown } }).options?.icon;
  authorIcon.set(leaf, own ?? defaultIconProto());
};

/** The author's icon for a leaf — the CAPTURED one when a write captured
 *  it (setIcon replaces options.icon in place, so after a write the live
 *  icon is the user's derived icon, not the author's), else the leaf's own
 *  live icon (a leaf that never wrote IS its author). The row and reset
 *  both read this, so the row never shows the user's paint as the author's
 *  and reset restores exactly what the row showed. */
const authorIconOf = (leaf: object): unknown =>
  authorIcon.get(leaf) ??
  (leaf as { options?: { icon?: unknown } }).options?.icon ??
  defaultIconProto();

/** The Leaflet default-icon prototype a leaf with no explicit icon falls
 *  back to, or undefined in a Leaflet-free DOM. */
const defaultIconProto = (): unknown => {
  // jsdom always defines the Leaflet global, so the no-L branch is a
  // Leaflet-free-DOM guard, not a state this flow produces.
  /* v8 ignore start -- Leaflet-free DOM only: this flow always runs with a
   * Leaflet global and a present Icon.Default.prototype; both arms are
   * guards for a DOM we never reach. */
  if (typeof L === "undefined") return undefined;
  return (
    (L as { Icon?: { Default?: { prototype?: unknown } } }).Icon?.Default?.prototype ??
    undefined
  );
  /* v8 ignore stop */
};

/** The author's own glyph paint for one icon, read in the SAME order the
 *  derive consumes it: the inner <i> inline color (the author's createIcon
 *  output — awesome-markers paints the glyph inline) first, then the declared
 *  iconColor option, then nothing (the caller applies its own default, e.g.
 *  "#ffffff"). `renderedDiv` lets the derive pass the div it already built so
 *  it is not created twice; without it the icon's createIcon is called once.
 *  Empty strings mean "no paint" and fall through, matching the derive's ??
 *  chain. The row and the derive both call this — one read, one order. */
const authorGlyphColorOf = (
  icon: unknown,
  renderedDiv?: HTMLElement | null,
): string | undefined => {
  let div = renderedDiv;
  if (!div) {
    const create = (icon as { createIcon?: unknown })?.createIcon;
    if (typeof create === "function") {
      div = (create as () => HTMLElement).call(icon) as HTMLElement;
    }
  }
  const inner = div ? div.querySelector("i") : null;
  const inline = inner ? (inner as HTMLElement).style.color : "";
  if (inline) return inline;
  const declared = (icon as { options?: { iconColor?: unknown } })?.options?.iconColor;
  return typeof declared === "string" && declared !== "" ? declared : undefined;
};

/** Derive a marker icon that swaps only the inner symbol. The author's icon
 *  object is the prototype; `createIcon` is overridden to build the same
 *  chassis div (via `_setIconStyles` with the author’s chassis paint) but with
 *  our glyph as the inner content. Every other inherited member —
 *  `createShadow`, `options`, `_setIconStyles` — is reused verbatim, so the
 *  sprite background, className, iconSize and popupAnchor stay pixel-identical.
 *
 *  The chassis color and the glyph/color/opacity are three orthogonal paints.
 *  A chassis-color write re-derives the pin background (the awesome-markers
 *  sprite) in the SAME derived icon; a glyph write re-derives the inner <i>.
 *  One construction, one `setIcon` — the three never split.
 *
 *  Returns the derived icon object (already `Object.create(author)`), or the
 *  author’s icon unchanged when the author is not a Leaflet icon (no
 *  `createIcon` to override) — honest degradation, not a fabricated divIcon.
 */
const buildMarkerIcon = (opts: {
  /** The author’s captured icon object (or the Leaflet default prototype). */
  author: unknown;
  /** The glyph name to render. */
  glyph: string;
  /** A user-set icon color (hex) to merge into the same construction as
   *  the glyph — `setIcon` replaces the whole icon object, so the color and
   *  the glyph must land in one derived icon, never two successive writes. */
  color?: string;
  /** A user-set chassis color (hex). A hex that is one of the 19
   *  awesome-markers presets keeps the library’s sprite class (pixel-identical);
   *  a non-preset hex takes the flat mask (the sprite as a mask-image, the
   *  baked gradient/stroke lost — the sprite’s physical limit). Independent of
   *  the glyph color: both must land in the SAME derived icon, one `setIcon`. */
  markerColor?: string;
  /** A user-set chassis opacity (0-100 integer). Absent = opaque (100). Rides
   *  the chassis span’s opacity (both preset and custom), so the glyph is
   *  unaffected. Independent of the glyph opacity. */
  markerColorOpacity?: number;
  /** A user-set glyph opacity (0-100 integer). Absent = opaque (100), which
   *  keeps the author’s own alpha when only the color is re-derived. */
  opacity?: number;
  /** The FontAwesome family the applied glyph renders under — the panel's
   *  control-level prefix (coerced), not the author's, because the applied
   *  glyph is a panel choice. */
  prefix?: string;
}): unknown => {
  const author = opts.author as
    { createIcon?: () => HTMLElement; options?: { iconColor?: string } } | undefined;
  if (!author || typeof author.createIcon !== "function") return opts.author;
  // Leaflet’s L.Icon.Default builds an <img> in createIcon; a DivIcon (or an
  // awesome-markers icon) builds a <div>. For the default chassis, reusing the
  // author’s <img> and setting innerHTML is a no-op (an <img> has no children),
  // so the glyph would silently vanish and Leaflet would fall back to the
  // default anchor, dropping the glyph below the point. Take the default icon
  // down a dedicated DivIcon branch that carries the glyph in an HTML shell and
  // pins the default 25x41 / [12,41] anchor (task #932 step 1).
  const isDefaultIcon =
    author instanceof L.Icon.Default ||
    author.createIcon?.() instanceof HTMLImageElement;
  const glyph = resolveGlyph(opts.glyph);
  const prefix = opts.prefix ?? DEFAULT_GLYPH_PREFIX;
  // The glyph and the chassis are orthogonal. A chassis-color write
  // (markerColor) must still re-derive the chassis even when the glyph name
  // is not a painted FA6 name — the author’s own inner glyph is kept, and
  // only the chassis (pin background) changes. A glyph-only write degrades
  // honestly to the author icon (no substituted symbol, no tofu).
  const glyphRenderable = glyph !== null && glyphAvailable(glyph, prefix);
  if (glyph !== null && !glyphRenderable && !warnedGlyphs.has(glyph)) {
    warnedGlyphs.add(glyph);
    log.warn(
      `glyph "${glyph}" is not in the loaded FontAwesome stylesheet — keeping the author glyph`,
    );
  }
  const wantChassis = opts.markerColor !== undefined;
  if (!wantChassis && !glyphRenderable) {
    // A pure glyph write (no chassis change) with a non-renderable name keeps
    // the author’s icon — the honest degradation, never a substituted symbol.
    return opts.author;
  }
  // The chassis color path needs the preset verdict. `presetNameOfHex` maps a
  // user hex back to a preset name when it is exactly one of the 19; a
  // non-preset hex (or a bogus value a caller failed to validate) takes the
  // mask path. The author’s declared preset name maps forward to its hex for
  // the row default (done by the caller); here the direction is the reverse.
  const chassisHex = opts.markerColor;
  const chassisPreset =
    typeof chassisHex === "string" ? presetNameOfHex(chassisHex) : null;
  const chassisOpacity = opts.markerColorOpacity ?? 100;
  if (isDefaultIcon) {
    // The default chassis is an <img> — there is no awesome-markers sprite
    // to re-color, and a non-renderable glyph would be tofu. A chassis write
    // cannot reach here (the capability gate admits div-based icons only),
    // so keep the author icon when the glyph isn’t renderable.
    if (!glyphRenderable) return opts.author;
    // The default chassis carries no author paint to inherit, so paint the
    // glyph explicitly — white when neither the user nor the author named a
    // color, the same default the derive path uses. One color, one alpha.
    const defaultPaint = composeColorAlpha(opts.color ?? "#fff", opts.opacity ?? 100);
    return L.divIcon({
      className: "foliplus-marker-default",
      html: glyphHtml(glyph, "", `color:${defaultPaint}`, prefix),
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
  }
  const derived = Object.create(author) as {
    createIcon: () => HTMLElement | undefined;
    createShadow?: () => HTMLElement | undefined;
  };
  derived.createIcon = function (this: unknown) {
    // Reuse the author’s own chassis build and swap only the inner
    // content — className, backgroundImage/backgroundPosition, iconSize
    // and popupAnchor stay pixel-identical by construction, which is
    // exactly the DOM-level contract the lead pinned (m01511).
    // A user chassis color re-derives the preset class through the author’s
    // own `_setIconStyles` (the awesome-markers override paints
    // `awesome-marker-icon-<color>` from `options.markerColor`), so the
    // sprite — gradient, stroke, offsets — is never re-created in CSS.
    if (opts.markerColor !== undefined) {
      // A shallow spread would drop the awesome-markers DEFAULT options
      // (className: "awesome-marker", iconSize, anchors, shadow...) that the
      // constructor inherits through the prototype chain — the re-derived
      // class came out as "awesome-marker-icon-blue undefined". Inherit the
      // author’s options object so the defaults stay reachable, then
      // override just the chassis color on top.
      const authorOptions = (author as { options?: object }).options;
      (this as { options?: { markerColor?: string } }).options = Object.assign(
        Object.create(authorOptions ?? null),
        { markerColor: chassisPreset ?? chassisHex },
      );
    }
    const div = author.createIcon?.call(this) as HTMLElement | undefined;
    if (!div) return div;
    // Carry the author’s inner <i> class + inline color (awesome-markers
    // paints `icon-white` via a class and an inline color), so our glyph
    // inherits the same paint. No inline author color -> white (a computed
    // color is not a signal: every element computes one, so reading it would
    // turn "the author named nothing" into black). The color dimension
    // itself is the icon color dimension.
    const authorInner = div.querySelector("i");
    // The user's color wins; else the author's own glyph paint, read in ONE
    // order by the shared authorGlyphColorOf (the inner <i> inline color —
    // awesome-markers paints the glyph inline, the same paint the author's
    // createIcon produced — else the declared iconColor option); else white.
    // options.markerColor is the CHASSIS color (the pin's background) — the
    // chassis is handled in buildMarkerIcon's markerColor path above, never
    // read as a glyph source here. One derivation, one paint — color and
    // glyph never split.
    const iconColor = opts.color ?? authorGlyphColorOf(author, div) ?? "#fff";
    // One paint, one alpha. A user color paints at the user's opacity
    // (default 100 = opaque); an author-derived color keeps the author's own
    // alpha parsed from the source, so an opacity-only write never silently
    // resets the alpha the author drew.
    const userColor = typeof opts.color === "string";
    const parsed = parseColorAlpha(iconColor);
    const paintHex = parsed?.hex ?? iconColor;
    const paintAlpha = userColor ? (opts.opacity ?? 100) : (parsed?.alpha ?? 100);
    const paint = composeColorAlpha(paintHex, paintAlpha);
    // Drop the author’s own icon-font classes (fa / fas / fa-star /
    // glyphicon-*) so only the paint classes survive and our FA glyph is the
    // one thing painting.
    const authorClass = (authorInner?.className ?? "")
      .split(/\s+/)
      .filter(
        cls =>
          cls &&
          !/^fa[srbl]?$/.test(cls) &&
          !cls.startsWith("fa-") &&
          !cls.startsWith("glyphicon"),
      )
      .join(" ");
    // A chassis-only write with a non-renderable glyph name keeps the
    // author’s inner glyph verbatim — only the chassis (pin background)
    // re-derives. The glyph is honest degradation, never a substituted symbol.
    if (glyphRenderable) {
      div.innerHTML = glyphHtml(glyph, authorClass, `color:${paint}`, prefix);
    }
    // The chassis span: carries ONLY the pin pixels with its own opacity, so
    // the glyph <i> (a sibling) is never faded with the pin. Two shapes:
    //   • preset + alpha 100 — the library class already paints the sprite
    //     pixel-identical (#1033); NO span, NO extra DOM (the fastest, and the
    //     preset round-trip stays author-identical).
    //   • preset + alpha < 100 — a span with the sprite as a background and
    //     the alpha as the span’s opacity (gradient/stroke preserved).
    //   • custom (any alpha) — a span with the sprite as a MASK (same URL,
    //     same offset) and `background-color: <hex>` as the paint; the baked
    //     gradient/stroke are color channels, not alpha, so they are lost (the
    //     sprite’s physical limit — documented in the PR).
    // The container div keeps the library sprite class (the author’s own
    // createIcon painted it via _setIconStyles); when a span carries the pin,
    // the container’s sprite is cleared so the pin is painted once.
    const wantChassisSpan =
      opts.markerColor !== undefined &&
      (chassisPreset === null || chassisOpacity < 100);
    if (wantChassisSpan && chassisHex) {
      const sprite = readChassisSprite(chassisPreset ?? "blue", div);
      if (sprite) {
        div.style.backgroundImage = "none";
        const span = document.createElement("span");
        span.className = "foliplus-marker-chassis";
        if (chassisPreset) {
          span.style.backgroundImage = sprite.url;
          span.style.backgroundPosition = sprite.position;
          span.style.backgroundRepeat = "no-repeat";
        } else {
          span.style.maskImage = sprite.url;
          span.style.maskPosition = sprite.position;
          span.style.maskRepeat = "no-repeat";
          span.style.backgroundColor = chassisHex;
        }
        if (chassisOpacity < 100) span.style.opacity = String(chassisOpacity / 100);
        div.appendChild(span);
      }
    }
    return div;
  };
  return derived;
};

/** Whether a leaf's mounted glyph already carries the requested glyph token
 *  under the requested FontAwesome prefix — the condition for a colour /
 *  opacity write to paint the mounted node in place instead of rebuilding the
 *  icon. False when the leaf is detached, or when the mounted symbol is the
 *  author's own (no `.foliplus-marker-glyph` — an honest degradation, a
 *  rebuild would be needed to re-derive). */
const mountedGlyphMatches = (
  el: HTMLElement,
  glyph: string | null,
  prefix: string,
): boolean => {
  const inner = el.querySelector(".foliplus-marker-glyph");
  if (!inner) return false;
  const cls = inner.className;
  const name = glyph ?? "circle";
  const token = name.startsWith("fa-") ? name : `fa-${name}`;
  return cls.includes(token) && cls.includes(prefix);
};

/** Paint the mounted glyph's colour in place (no icon rebuild). The paint is
 *  the same compose the derive path uses: a user colour paints at the user's
 *  opacity (default 100 = opaque). */
const paintMountedGlyphColor = (
  el: HTMLElement,
  color: string,
  opacity?: number,
): void => {
  const inner = el.querySelector(".foliplus-marker-glyph") as HTMLElement | null;
  if (!inner) return;
  const parsed = parseColorAlpha(color);
  const paintHex = parsed?.hex ?? color;
  const paint = composeColorAlpha(paintHex, opacity ?? 100);
  inner.style.color = paint;
};

/** Paint the mounted chassis span in place (no icon rebuild). Returns
 *  true when the write was handled in place — the mounted element already
 *  carries a chassis span AND the new paint still wants one (so the
 *  mechanism is preserved: sprite-to-sprite or mask-to-mask, only the offset /
 *  flat colour / opacity change). The span is re-derived fully (clearing
 *  both faces) so a preset-to-custom switch still paints correctly; a span
 *  presence change (custom / alpha<100 to preset at alpha 100, which drops
 *  the span) is NOT paintable in place and returns false so the caller
 *  rebuilds through the single setLeafIcon. */
const paintMountedChassis = (
  el: HTMLElement,
  markerColor: string,
  markerColorOpacity?: number,
): boolean => {
  const chassisPreset = presetNameOfHex(markerColor);
  const opacity = markerColorOpacity ?? 100;
  const wantSpan = chassisPreset === null || opacity < 100;
  const span = el.querySelector(".foliplus-marker-chassis") as HTMLElement | null;
  if (!span || !wantSpan) return false;
  // Re-derive the span's full paint so a preset-to-custom mechanism switch is
  // still a single in-place write (clear both faces, then apply the new one).
  span.style.backgroundImage = "";
  span.style.backgroundPosition = "";
  span.style.maskImage = "";
  span.style.maskPosition = "";
  span.style.backgroundColor = "";
  if (chassisPreset) {
    const sprite = readChassisSprite(chassisPreset, el);
    if (sprite) {
      span.style.backgroundImage = sprite.url;
      span.style.backgroundPosition = sprite.position;
    }
  } else {
    const sprite = readChassisSprite("blue", el);
    if (sprite) {
      span.style.maskImage = sprite.url;
      span.style.maskPosition = sprite.position;
    }
    span.style.backgroundColor = markerColor;
  }
  span.style.opacity = String(opacity / 100);
  return true;
};

/** The single `leaf.setIcon` call site. The architecture guard whitelists
 *  exactly this one direct call; every other icon write in this module either
 *  paints the already-mounted inner nodes in place (a pure colour / opacity
 *  write) or routes through here for a rebuild. */
const setLeafIcon = (leaf: L.Marker, derived: unknown): void => {
  leaf.setIcon(derived as Parameters<L.Marker["setIcon"]>[0]);
};

/** Apply the layer's glyph to every marker leaf, capturing each leaf's
 *  author icon on first write. A missing intent is a no-op — a layer the
 *  user never touched keeps exactly what the author declared. */
const applyIconToLeaves = (
  layer: L.Layer,
  glyph: string,
  color?: string,
  opacity?: number,
  prefix?: string,
): void => {
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    /* v8 ignore next -- defensive: captureAuthorIcon always sets a value */
    if (author === undefined) return;
    const derived = buildMarkerIcon({ author, glyph, color, opacity, prefix });
    setLeafIcon(leaf, derived);
  });
};

/** Apply the user's icon colour (and optional opacity) to every marker
 *  leaf. A pure colour/opacity write paints the already-mounted inner glyph
 *  node IN PLACE (no icon rebuild, no DOM churn, no `setIcon`); a glyph or
 *  prefix change still rebuilds through the single `setLeafIcon`. A missing
 *  intent is a no-op. */
const applyIconColorToLeaves = (
  layer: L.Layer,
  color: string,
  glyph: string | null,
  opacity?: number,
  prefix?: string,
): void => {
  const panelPrefix = prefix ?? DEFAULT_GLYPH_PREFIX;
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    /* v8 ignore next -- defensive: captureAuthorIcon always sets a value */
    if (author === undefined) return;
    // A colour/opacity-only write on an already-mounted leaf whose glyph is
    // unchanged paints the node in place — same element reference, no rebuild.
    const el = mountedIconElement(leaf);
    if (el && mountedGlyphMatches(el, glyph, panelPrefix)) {
      paintMountedGlyphColor(el, color, opacity);
      return;
    }
    const derived = buildMarkerIcon({
      author,
      glyph: glyph ?? "circle",
      color,
      opacity,
      prefix: panelPrefix,
    });
    setLeafIcon(leaf, derived);
  });
};

/** Apply the user's chassis colour (and optional opacity) to every marker
 *  leaf. A pure colour/opacity write paints the already-mounted chassis span
 *  IN PLACE (no icon rebuild); a glyph or prefix change still rebuilds
 *  through the single `setLeafIcon`. A missing intent is a no-op. */
const applyMarkerColorToLeaves = (
  layer: L.Layer,
  markerColor: string,
  glyph: string | null,
  color?: string,
  markerColorOpacity?: number,
): void => {
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    /* v8 ignore next -- defensive: captureAuthorIcon always sets a value */
    if (author === undefined) return;
    // A colour/opacity-only write on an already-mounted leaf whose chassis
    // span already carries the pin paints the span in place — same element
    // reference, no rebuild. A mechanism change (span dropped by a preset at
    // alpha 100) is not paintable in place and falls through to a rebuild.
    const el = mountedIconElement(leaf);
    if (el && paintMountedChassis(el, markerColor, markerColorOpacity)) {
      return;
    }
    const derived = buildMarkerIcon({
      author,
      glyph: glyph ?? "circle",
      color,
      markerColor,
      markerColorOpacity,
    });
    setLeafIcon(leaf, derived);
  });
};

/** Reset every marker leaf to the author's icon and drop the capture. The
 *  authored icons come from the WeakMap, never from a re-read — a re-read
 *  would restore the user's own choice, and a layer that never wrote has
 *  nothing to restore anyway. */
const resetIconLeaves = (layer: L.Layer): void => {
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    const captured = authorIcon.get(leaf);
    if (captured !== undefined) {
      // Leaflet's Icon.Default creates an <img> and _createImg REUSES the
      // existing element when the marker already has one. An <img> that
      // carries our glyph would be returned unchanged, so _initIcon sees
      // the glyph element as already attached and never swaps — the glyph would survive
      // Reset. Detach the glyph-laden element first so createIcon(null)
      // builds a fresh author <img> instead of reusing it.
      // The private icon-detach hooks live behind the single
      // Leaflet adapter (core/leafletAdapter.detachMarkerIcons) — this module
      // must not name them.
      detachMarkerIcons(leaf);
      setLeafIcon(leaf, captured);
    }
    authorIcon.delete(leaf);
  });
};

/** The author's declared glyph on a layer, with its syntax verdict.
 *  `valid` is false when the author wrote a name that fails glyph syntax (a
 *  typo — never renderable). The UI keeps the raw `name` either way so a
 *  wrong declaration is surfaced instead of silently reading as "Original". */
type AuthorGlyph = { name: string; valid: boolean };

/** The author's own glyph name when the layer's marker icon declares one
 *  (awesome-markers/Leaflet put the name in
 *  `leaf.options.icon.options.icon`). Used for the row preview only — the
 *  write semantics are unchanged: an uncovered layer keeps the author icon.
 *  Walks leaves and returns the first DECLARED name: the first syntactically
 *  valid one if any (existing short-circuit), else the first declared name
 *  whatever its syntax, so a typo is never silently dropped. Returns null only
 *  when no leaf declares a string icon name at all. */
const authorGlyphName = (layer: L.Layer): AuthorGlyph | null => {
  let found: AuthorGlyph | null = null;
  let invalid: AuthorGlyph | null = null;
  walkLeaf(layer, leaf => {
    if (found) return;
    if (!isIconLeaf(leaf)) return;
    const own = (leaf as { options?: { icon?: { options?: { icon?: unknown } } } })
      .options?.icon?.options?.icon;
    if (typeof own !== "string" || own.length === 0) return;
    const candidate = { name: own, valid: isGlyphSyntax(own) };
    if (candidate.valid) found = candidate;
    else invalid ??= candidate;
  });
  return found ?? invalid;
};

/** The author's FontAwesome family prefix (leaf.options.icon.options.prefix)
 *  for the same first icon leaf authorGlyphName recognizes. The render path
 *  (awesome-markers) paints `prefix + " " + icon`, so the availability probe
 *  must use this prefix — probing the panel's fa-solid family would mismatch
 *  an author who writes `prefix="fa"` (see glyphClassName). Returns null when
 *  the author declares no prefix (callers fall back to the panel family). */
const authorGlyphPrefix = (layer: L.Layer): string | null => {
  let found: string | null = null;
  walkLeaf(layer, leaf => {
    if (found) return;
    if (!isIconLeaf(leaf)) return;
    const own = (leaf as { options?: { icon?: { options?: { prefix?: unknown } } } })
      .options?.icon?.options?.prefix;
    if (typeof own === "string" && own.length > 0) found = own;
  });
  return found;
};

export {
  applyIconToLeaves,
  applyIconColorToLeaves,
  applyMarkerColorToLeaves,
  authorGlyphColorOf,
  authorIconOf,
  authorGlyphName,
  authorGlyphPrefix,
  buildMarkerIcon,
  captureAuthorIcon,
  isIconLeaf,
  parseColorAlpha,
  composeColorAlpha,
  resetIconLeaves,
};
export type { AuthorGlyph };
