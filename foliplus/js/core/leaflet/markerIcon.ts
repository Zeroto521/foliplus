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
  glyphAvailable,
  glyphHtml,
  isGlyphSyntax,
  resolveGlyph,
} from "./glyphSource.js";
import { walkLeaf } from "#core/layer/walkLeaf.js";
import { detachMarkerIcons } from "#core/lifecycle/leafletAdapter.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("icon-dimension");
/** Glyph names already warned as unavailable — warn once per name, not per
 *  leaf walk. The CSS is static, so a second encounter of the same name is
 *  the same fact. */
const warnedGlyphs = new Set<string>();

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

/** Derive a marker icon that swaps only the inner symbol. The author's icon
 *  object is the prototype; `createIcon` is overridden to build the same
 *  chassis div (via `_setIconStyles` with the author's chassis paint) but with
 *  our glyph as the inner content. Every other inherited member —
 *  `createShadow`, `options`, `_setIconStyles` — is reused verbatim, so the
 *  sprite background, className, iconSize and popupAnchor stay pixel-identical.
 *
 *  (Chassis / glyph color is out of scope here.)
 *
 *  Returns the derived icon object (already `Object.create(author)`), or the
 *  author's icon unchanged when the author is not a Leaflet icon (no
 *  `createIcon` to override) — honest degradation, not a fabricated divIcon.
 */
const buildMarkerIcon = (opts: {
  /** The author's captured icon object (or the Leaflet default prototype). */
  author: unknown;
  /** The glyph name to render. */
  glyph: string;
  /** A user-set icon color (hex) to merge into the same construction as
   *  the glyph — `setIcon` replaces the whole icon object, so the color and
   *  the glyph must land in one derived icon, never two successive writes. */
  color?: string;
}): unknown => {
  const author = opts.author as
    { createIcon?: () => HTMLElement; options?: { iconColor?: string } } | undefined;
  if (!author || typeof author.createIcon !== "function") return opts.author;
  // Leaflet's L.Icon.Default builds an <img> in createIcon; a DivIcon (or an
  // awesome-markers icon) builds a <div>. For the default chassis, reusing the
  // author's <img> and setting innerHTML is a no-op (an <img> has no children),
  // so the glyph would silently vanish and Leaflet would fall back to the
  // default anchor, dropping the glyph below the point. Take the default icon
  // down a dedicated DivIcon branch that carries the glyph in an HTML shell and
  // pins the default 25x41 / [12,41] anchor (task #932 step 1).
  const isDefaultIcon =
    author instanceof L.Icon.Default ||
    author.createIcon?.() instanceof HTMLImageElement;
  const glyph = resolveGlyph(opts.glyph);
  // An invalid (non-syntax) name renders nothing of ours: keep the author
  // icon (honest degradation, never a substituted symbol).
  if (!glyph) return opts.author;
  // A syntactically valid name the loaded FA stylesheet does not paint is
  // also an honest degradation — warn once per name (the CSS is static, so
  // the availability probe is cached) and keep the author's original icon
  // rather than render a blank tofu. */
  if (!glyphAvailable(glyph)) {
    if (!warnedGlyphs.has(glyph)) {
      warnedGlyphs.add(glyph);
      log.warn(
        `glyph "${glyph}" is not in the loaded FontAwesome stylesheet — keeping the author icon`,
      );
    }
    return opts.author;
  }
  if (isDefaultIcon) {
    return L.divIcon({
      className: "foliplus-marker-default",
      html: glyphHtml(glyph),
      iconSize: [25, 41],
      iconAnchor: [12, 41],
    });
  }
  const derived = Object.create(author) as {
    createIcon: () => HTMLElement | undefined;
    createShadow?: () => HTMLElement | undefined;
  };
  derived.createIcon = function (this: unknown) {
    // Reuse the author's own chassis build and swap only the inner
    // content — className, backgroundImage/backgroundPosition, iconSize
    // and popupAnchor stay pixel-identical by construction, which is
    // exactly the DOM-level contract the lead pinned (m01511).
    const div = author.createIcon?.() as HTMLElement | undefined;
    if (!div) return div;
    // Carry the author's inner <i> class + inline color (awesome-markers
    // paints `icon-white` via a class and an inline color), so our glyph
    // inherits the same paint. No inline author color -> white (a computed
    // color is not a signal: every element computes one, so reading it would
    // turn "the author named nothing" into black). The color dimension
    // itself is the icon color dimension.
    const authorInner = div.querySelector("i");
    const authorInlineColor = authorInner
      ? (authorInner as HTMLElement).style.color
      : "";
    // The user's color wins; else the author's inner <i> inline color
    // (awesome-markers paints the glyph inline — the same paint the author's
    // createIcon produced); else the author's declared iconColor option;
    // else white. options.markerColor is the CHASSIS color (the pin's
    // background), NOT a glyph source — never read it here. One derivation,
    // one paint — color and glyph never split.
    const authorIconColor = (author as { options?: { iconColor?: string } }).options
      ?.iconColor;
    // Empty string means "no author paint" (awesome-markers leaves the glyph
    // uncolored), so normalise empties to undefined and fall through with ??.
    const inlineColor = authorInlineColor || undefined;
    // Normalise an empty author iconColor to undefined so a declared-but-empty
    // value falls through to the default (a non-nullish empty string must not
    // win over the default).
    const authorIconColorVal = authorIconColor === "" ? undefined : authorIconColor;
    const iconColor = opts.color ?? inlineColor ?? authorIconColorVal ?? "#fff";
    // Drop the author's own icon-font classes (fa / fas / fa-star /
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
    div.innerHTML = glyphHtml(glyph, authorClass, `color:${iconColor}`);
    return div;
  };
  return derived;
};

/** Apply the layer's glyph to every marker leaf, capturing each leaf's
 *  author icon on first write. A missing intent is a no-op — a layer the
 *  user never touched keeps exactly what the author declared. */
const applyIconToLeaves = (layer: L.Layer, glyph: string, color?: string): void => {
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    /* v8 ignore next -- defensive: captureAuthorIcon always sets a value */
    if (author === undefined) return;
    const derived = buildMarkerIcon({ author, glyph, color });
    leaf.setIcon(derived as Parameters<L.Marker["setIcon"]>[0]);
  });
};

/** Apply the user's marker color to every marker leaf, re-deriving the
 *  icon in ONE construction with the given glyph (the user's current glyph
 *  from the icon intent, or the author's recognised glyph name, or the
 *  author icon's inner glyph) so the color and the glyph never split
 *  across two `setIcon` writes. A missing intent is a no-op. */
const applyIconColorToLeaves = (
  layer: L.Layer,
  color: string,
  glyph: string | null,
): void => {
  walkLeaf(layer, leaf => {
    if (!isIconLeaf(leaf)) return;
    captureAuthorIcon(leaf);
    const author = authorIcon.get(leaf);
    /* v8 ignore next -- defensive: captureAuthorIcon always sets a value */
    if (author === undefined) return;
    const derived = buildMarkerIcon({
      author,
      glyph: glyph ?? "circle",
      color,
    });
    leaf.setIcon(derived as Parameters<L.Marker["setIcon"]>[0]);
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
      leaf.setIcon(captured as Parameters<L.Marker["setIcon"]>[0]);
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
  authorGlyphName,
  authorGlyphPrefix,
  buildMarkerIcon,
  captureAuthorIcon,
  isIconLeaf,
  resetIconLeaves,
};
export type { AuthorGlyph };
