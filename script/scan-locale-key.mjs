#!/usr/bin/env node
/**
 * Scan JS source for locale key usage and emit the sorted set of full keys
 * used by the code, so the Python test suite can derive `_JS_USED_KEYS`
 * from the scanner rather than maintaining a hand-written list.
 *
 * Approach: extract string literals from specific key-producing contexts:
 *   - T("key") / _("key") calls (scoped/unscoped translators)
 *   - localeFallback(code, "key", "fallback") calls
 *   - NAME_LABEL_KEY = "short" static props
 *   - Template literals with `${CONFIG.name}` (e.g., `${CONFIG.name}.popup_title_geo`)
 *
 * Keying rules:
 *   - `T("key")` (scoped)  →  `<ControlName>.<key>` (full keys pass through)
 *   - `_("key")` (unscoped) →  `key` as-is
 *   - `NAME_LABEL_KEY = "short"` static prop → `<ControlName>.<short>`
 *   - `core/layer/` files → treated as `LayerControl`
 *
 * Usage: `node script/scan-locale-key.mjs [dir]` → JSON array on stdout.
 *
 * Known gaps (see _DYNAMIC_SUPPLEMENT in test_locale.py):
 *   - Dynamic key construction (template literals, ternaries, map lookups)
 *   - Object property values that are keys
 */
import fs from "node:fs";
import path from "node:path";

const ROOT =
  process.argv[2] ?? path.resolve(import.meta.dirname, "..", "foliplus", "js");

const CONTROLS = [
  "ExportControl",
  "FullscreenControl",
  "HeatmapControl",
  "LayerControl",
  "LocateControl",
  "MeasureControl",
  "ScaleControl",
  "SearchControl",
];

/** Map a file path under `ROOT` to its control prefix, or null for shared/core. */
const prefixFor = rel => {
  const top = rel.split(/[\\/]/)[0];
  return CONTROLS.includes(top) ? top : null;
};

/** Strip block and line comments. Locale keys never contain `//` or `/*`. */
const stripComments = src =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Extract all quoted string literals from a string. */
const extractLiterals = text => {
  const out = [];
  for (const m of text.matchAll(/(['"])((?:(?!\1).)+)\1/g)) out.push(m[2]);
  return out;
};

// Combined T(...)/_(...) matcher — one pass instead of two. `[^()]*` keeps
// us from crossing nested parens; `T(foo("a"))` truncates at the first `)`.
const CALL_RE = /\b([T_])\s*\(([^()]*)\)/g;

// localeFallback(code, "key", "fallback") — second arg is the key.
const LOCALE_FALLBACK_RE = /\blocaleFallback\s*\(\s*[^,]+,\s*(['"])((?:(?!\1).)+)\1/g;

// NAME_LABEL_KEY = "short" static props.
const STATIC_KEY_RE = /\bNAME_LABEL_KEY\s*=\s*(['"])((?:(?!\1).)+)\1/g;

// Template literals containing `${CONFIG.name}` — capture the full template,
// then extract the suffix after `}`.
const TEMPLATE_KEY_RE = /`([^`]*\$\{[^}]*CONFIG\.name[^}]*\}[^`]*)`/g;

const isFullKey = k => k.includes(".");

const collect = (rel, src) => {
  const prefix = prefixFor(rel);
  const text = stripComments(src);
  const keys = new Set();

  // T(...) / _(....) — scoped vs unscoped.
  for (const m of text.matchAll(CALL_RE)) {
    const scoped = m[1] === "T";
    for (const lit of extractLiterals(m[2])) {
      if (isFullKey(lit)) keys.add(lit);
      else if (scoped && prefix) keys.add(`${prefix}.${lit}`);
      else if (!scoped) keys.add(lit);
    }
  }

  // localeFallback(code, "key", "fallback")
  for (const m of text.matchAll(LOCALE_FALLBACK_RE)) keys.add(m[2]);

  // NAME_LABEL_KEY = "short"
  for (const m of text.matchAll(STATIC_KEY_RE)) {
    const lit = m[2];
    keys.add(prefix ? `${prefix}.${lit}` : lit);
  }

  // Template literals with ${CONFIG.name} — suffix after `}`.
  for (const m of text.matchAll(TEMPLATE_KEY_RE)) {
    const suffix = m[1].match(/\}\.(\w+)/);
    if (suffix && prefix) keys.add(`${prefix}.${suffix[1]}`);
  }

  return keys;
};

const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      out.push(p);
    }
  }
  return out;
};

const used = new Set();
for (const file of walk(ROOT)) {
  const src = fs.readFileSync(file, "utf8");
  for (const k of collect(path.relative(ROOT, file), src)) used.add(k);
}

process.stdout.write(JSON.stringify([...used].sort(), null, 2) + "\n");
