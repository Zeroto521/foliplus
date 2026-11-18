// Source-transform utilities for the foliplus build pipeline.
//
// Pure functions — no esbuild dependency, so they can be unit-tested or
// reused by other tooling (e.g. a watch script).
//
// Two transforms are applied:
//   1. SVGO — compress inline SVG markup inside backtick template literals
//   2. HTML — collapse whitespace in ``innerHTML`` template literals
//
// ``transformSource(code)`` runs both in sequence and is the main entry point.
// Individual functions are exported for targeted testing.
import { optimize } from "svgo";

// ── SVGO: compress SVG template literals ─────────────────────────
// Matches ``<svg>…</svg>`` or ``<div>…<svg>…</svg>…</div>`` inside backticks.
const SVG_RE =
  /`\s*(?:<div[^>]*>\s*<svg[\s\S]*?<\/svg>\s*<\/div>|<svg[\s\S]*?<\/svg>)\s*`/g;

const compressSvg = svg => {
  try {
    return optimize(svg, { multipass: true }).data;
  } catch {
    return null;
  }
};

/** Compress SVG template literals in source code. */
const compressSvgStrings = code => {
  return code.replace(SVG_RE, match => {
    const raw = match.replace(/^`\s*/, "").replace(/\s*`$/, "");
    // If wrapped in a <div>, extract the <svg> part, optimize it, then rewrap
    const divMatch = raw.match(/^(<div[^>]*>)\s*([\s\S]*?)\s*(<\/div>)$/);
    const openTag = divMatch?.[1];
    const inner = divMatch?.[2];
    const closeTag = divMatch?.[3];
    const svgMatch = inner?.match(/<svg[\s\S]*?<\/svg>/);
    if (openTag && svgMatch) {
      const compressed = compressSvg(svgMatch[0]);
      if (compressed) return `\`${openTag}${compressed}${closeTag}\``;
      return match;
    }
    const compressed = compressSvg(raw);
    return compressed ? `\`${compressed}\`` : match;
  });
};

// ── HTML minifier: compress innerHTML template literals ──────────
// Uses a character-level scanner to correctly handle nested backtick
// template literals (e.g. ``${CONFIG.name}`` inside the HTML template).
// Only processes templates that look like HTML (contain ``<tag``).

const HTML_RE = /<[a-z][a-z0-9]*[\s>]/i;

/** Find the end of a template literal given the start of the opening backtick.
 *  Handles nested ``${…}`` expressions by tracking brace depth. */
const findTemplateEnd = (code, start) => {
  let i = start + 1;
  let depth = 0;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "`" && depth === 0) return i;
    if (ch === "$" && code[i + 1] === "{" && depth === 0) {
      depth = 1;
      i += 2;
    } else if (depth > 0) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    } else i++;
  }
  return -1;
};

/** Collapse multi-line whitespace: newlines → single space, ``> <`` → ``><``. */
const collapseHtml = html =>
  html
    .replace(/\n\s*/g, " ")
    .replace(/>\s+</g, "><")
    .replace(/\s{2,}/g, " ")
    .trim();

/** Compress HTML-looking template literals in source code.
 *
 *  The scanner is comment/string aware: backticks inside // line comments,
 *  block comments, and '…' / "…" string literals are literal text, not
 *  template delimiters. A comment backtick pairing with a real template-
 *  literal backtick across a *\/ boundary would otherwise be collapsed as an
 *  HTML-looking span and mangle real code. */
const compressHtmlStrings = code => {
  const result = [];
  let i = 0;
  const n = code.length;
  while (i < n) {
    const ch = code[i];
    // Line comment: skip to end of line (backticks inside are text).
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i + 2);
      const end = nl === -1 ? n : nl;
      result.push(code.slice(i, end));
      i = end;
      continue;
    }
    // Block comment: skip to closing */ (backticks inside are text).
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      if (close === -1) {
        result.push(code.slice(i));
        break;
      }
      result.push(code.slice(i, close + 2));
      i = close + 2;
      continue;
    }
    // String literal: skip to matching quote (backticks inside are text).
    if (ch === "'" || ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (code[j] === "\\") {
          j += 2;
          continue;
        }
        if (code[j] === ch) break;
        j++;
      }
      const end = j < n ? j + 1 : n;
      result.push(code.slice(i, end));
      i = end;
      continue;
    }
    // Template literal: compress when it looks like HTML.
    if (ch === "`") {
      const end = findTemplateEnd(code, i);
      if (end === -1) {
        result.push(code.slice(i));
        break;
      }
      const raw = code.slice(i + 1, end);
      if (HTML_RE.test(raw)) result.push("`" + collapseHtml(raw) + "`");
      else result.push(code.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    result.push(ch);
    i++;
  }
  return result.join("");
};

/** Apply all source transforms to a file's content: SVG first, then HTML. */
const transformSource = code => compressHtmlStrings(compressSvgStrings(code));

export { compressHtmlStrings, compressSvgStrings, transformSource };
