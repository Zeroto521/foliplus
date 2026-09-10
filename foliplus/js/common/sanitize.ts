// SVG sanitisation — the single gate for every HTML sink that accepts SVG
// strings from a caller other than this bundle's own icon tables.
//
// Three sinks need it: LayerControl's type-icon column (opts.iconSvg from
// LayerAPI.registerLayer / createLayers), HintManager's registered hint icons,
// and — via the element-returning popup builder — reverse-geocoded addresses.
// The three trust domains are disjoint (third-party API options, locale JSON,
// author code), so the gate has to be an allowlist rather than a per-caller
// escape hatch.

const XHTML_NS = "http://www.w3.org/1999/xhtml";

/** Presentation attributes that cannot reach code execution or leave the
 *  SVG subtree. `href` is handled separately — only same-document `#fragment`
 *  refs (`<use>`) are allowed, anything else is dropped. */
/** Stored lowercased. `Set` is case-sensitive, so `viewBox` must be keyed as
 *  `viewbox` or `viewBox`/`viewbox` inputs would be rejected — but the
 *  serialised attribute name is never rewritten, so `viewBox` is preserved
 *  verbatim in the output. */
const ALLOWED_ATTRS = new Set(
  [
    "class",
    "color-interpolation",
    "cx",
    "cy",
    "d",
    "fill",
    "fill-opacity",
    "font-family",
    "font-size",
    "font-weight",
    "height",
    "opacity",
    "points",
    "r",
    "rx",
    "ry",
    "shape-rendering",
    "stroke",
    "stroke-dasharray",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-opacity",
    "stroke-width",
    "text-anchor",
    "transform",
    "viewBox",
    "width",
    "x",
    "x1",
    "x2",
    "y",
    "y1",
    "y2",
    "aria-label",
    "role",
    "xmlns",
  ].map(a => a.toLowerCase()),
);

/** Elements inside an SVG that can execute code or escape the SVG subtree.
 *  Parsing as `image/svg+xml` keeps them inert but still serialised, so they
 *  are dropped here rather than left for the downstream innerHTML sink. */
const FORBIDDEN_TAGS = new Set([
  "script",
  "foreignObject",
  "iframe",
  "object",
  "embed",
  "use",
]);

/** A `<style>` inside an SVG must be pure CSS rules — no `javascript:` and no
 *  tag-like content that could break out of the style text. Repository icons
 *  legitimately use `fill:var(--…)`, so var() must survive. */
const STYLE_RULE_RE = /^[\s\S]*\{[\s\S]*\}$/;
const STYLE_BAD_RE = /(javascript:|<)/i;

/** An attribute value carrying a URL: a `url(…)` wrapper, a bare scheme
 *  (`fill="http://…"`, `data:`), or a protocol-relative ref.
 *
 *  Deliberately narrow. Anything with a colon that is NOT a URL must keep
 *  working — `fill="none"`, `stroke="currentColor"`, `fill="#fff"`, `var()`,
 *  and the unquoted local ref `fill="url(#g)"`. Those have colons because the
 *  CSS value grammar is not a URL, not because they fetch. */
const isUrlValue = (v: string): boolean => {
  const s = v.trim().toLowerCase();
  if (s.startsWith("url(")) {
    const inner = s.slice(4, s.length - 1).trim().replace(/^["']|["']$/g, "");
    return isUrlRef(inner);
  }
  return isUrlRef(s);
};

const isUrlRef = (v: string): boolean =>
  v.startsWith("//") ||
  v.startsWith("data:") ||
  /^(?!#)[a-z][a-z0-9+.-]*:/.test(v);

/** Keep only the first SVG in `html`, with active content stripped.
 *  Returns "" when the fragment holds no SVG or no SVG content worth keeping.
 *
 *  Parsing must be `image/svg+xml`, not `text/html`: the SVG namespace is
 *  what makes `<foreignObject>`/HTML breakout inert, and it keeps attribute
 *  case intact. A `text/html` parse silently moves SVG markup into the HTML
 *  namespace, which both defeats the namespace check and normalises
 *  `viewBox` to `viewbox`. */
const parseSVG = (html: string): string => {
  if (!html) return "";

  const doc = new DOMParser().parseFromString(html, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName !== "svg") return "";
  // A well-formed SVG document has exactly one root. Extra roots make the
  // parser error out (jsdom yields a `parsererror` element, which the
  // namespace check above rejects) — report that as "no icon" rather than
  // trying to salvage a tree the parser refused to build.
  if (doc.childNodes.length > 1) return "";
  if (!svg.hasChildNodes()) return "";

  // The root svg's own attributes count — `parseFromString` puts them on the
  // documentElement, which the child walk below never visits.
  stripAttrs(svg);
  sanitizeSubtree(svg);
  return svg.hasChildNodes() ? svg.outerHTML : "";
};

const stripAttrs = (el: Element): void => {
  for (const attr of [...el.attributes]) {
    if (!isAllowedAttr(attr.name, attr.value)) el.removeAttribute(attr.name);
  }
};

/** Walk a subtree, dropping non-SVG elements, forbidden tags, and
 *  non-allowlisted attributes. */
const sanitizeSubtree = (node: Element): void => {
  for (const el of [...node.children]) {
    const lower = el.tagName.toLowerCase();
    if (el.namespaceURI === XHTML_NS || FORBIDDEN_TAGS.has(lower)) {
      el.remove();
      continue;
    }
    if (lower === "style") {
      const text = el.textContent ?? "";
      if (!STYLE_RULE_RE.test(text) || STYLE_BAD_RE.test(text)) el.remove();
      continue;
    }
    stripAttrs(el);
    sanitizeSubtree(el);
  }
};

const isAllowedAttr = (name: string, value: string): boolean => {
  // Match by canonical lowercase form; `ALLOWED_ATTRS` is stored the same way.
  const lower = name.toLowerCase();
  // Attribute names cannot be event handlers.
  if (lower.startsWith("on")) return false;
  if (lower === "href") {
    // Only a same-document fragment — `#dot`, never a scheme or `#//evil`.
    const v = value.trim();
    return v.startsWith("#") && v.length > 1 && !v.slice(1).includes("//");
  }
  if (!ALLOWED_ATTRS.has(lower)) return false;
  // Presentation attributes must not carry a URL. An external paint server
  // (`fill="url(http://…)"`) is a network fetch and an exfiltration channel;
  // a local ref (`fill="url(#g)"`) is ordinary SVG and stays.
  if (isUrlValue(value)) return false;
  return true;
};

/** `iconSvg` helper: only a non-empty result survives, otherwise fall back. */
const safeSVG = (html: string | null | undefined, fallback = ""): string =>
  html ? parseSVG(html) || fallback : fallback;

export { parseSVG, safeSVG };
