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
 *   - Template literals with `${CONF.name}` (e.g., `${CONF.name}.popup_title_geo`)
 *
 * Keying rules:
 *   - `T("key")` (scoped translator) in a control dir  →  `<ControlName>.<key>`
 *   - `T("full.key")` (full key even via scoped T)     →  `full.key`
 *   - `_("key")` (unscoped translator)                 →  `key` as-is
 *   - `NAME_LABEL_KEY = "short"` static prop            →  `<ControlName>.<short>`
 *     (base.ts deliberately uses unscoped `_(short)` for identity fallback,
 *      but the locale tables still key these as `<Control>.<short>`; recording
 *      them here keeps the tables in sync with how they are keyed today.)
 *   - `core/layer/` files                              →  treated as `LayerControl`
 *     (some shared-core T() calls are forwarded from caller components, so a
 *      small _SHARED_LAYER_KEYS supplement in the test expands across all
 *      callers that actually need the key — see test_locale.py.)
 *
 * Usage: `node script/scan-locale-keys.mjs [dir]` → JSON array on stdout.
 *
 * Known gaps:
 *   - Dynamic key construction via ternary branches (`` cond ? "a" : "b" ``)
 *     where the result is passed to T() as a variable — the scanner can't
 *     statically determine the value. Those keys are documented at the call
 *     site instead.
 *   - Object property values that are keys (e.g., `` key: "type_base" ``)
 *     — same limitation as ternary branches.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? path.resolve(import.meta.dirname, "..", "foliplus", "js");

// Control names — the top-level dirs under `foliplus/js/` that own a locale table.
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
const prefixFor = (rel) => {
  const segs = rel.split(/[\\/]/);
  const top = segs[0];
  if (CONTROLS.includes(top)) return top;
  return null; // core/, common/, runtime/, type/ — full-key-only files
};

/** Naive comment stripper. Locale keys never contain `//` or `/*`. */
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/** Extract all string literals (single or double quoted) from a string. */
const extractLiterals = (text) => {
  const out = [];
  const re = /(['"])((?:(?!\1).)+)\1/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[2]);
  return out;
};

// Match T(...) or _(...) calls. `[^()]*` inside keeps us from crossing nested
// parens; callers like `T(foo("a"))` will be truncated at the first `)`.
const T_CALL_RE = /\bT\s*\(([^()]*)\)/g;
const _CALL_RE = /\b_\s*\(([^()]*)\)/g;

// Match localeFallback(code, "key", "fallback") — extract the second arg.
const LOCALE_FALLBACK_RE = /\blocaleFallback\s*\(\s*[^,]+,\s*(['"])((?:(?!\1).)+)\1/g;

// Match NAME_LABEL_KEY = "short" static props.
const STATIC_KEY_RE = /\bNAME_LABEL_KEY\s*=\s*(['"])((?:(?!\1).)+)\1/g;

// Match template literals containing `${CONF.name}` — extract the suffix.
const TEMPLATE_KEY_RE = /`([^`]*\$\{[^}]*CONF\.name[^}]*\}[^`]*)`/g;

const isFullKey = (k) => typeof k === "string" && k.length > 0 && k.includes(".");

const collect = (rel, src) => {
  const prefix = prefixFor(rel);
  const text = stripComments(src);
  const keys = new Set();

  // T() calls: scoped translator.
  for (const m of text.matchAll(T_CALL_RE)) {
    for (const lit of extractLiterals(m[1])) {
      if (isFullKey(lit)) keys.add(lit);
      else if (prefix) keys.add(`${prefix}.${lit}`);
    }
  }

  // _() calls: unscoped translator.
  for (const m of text.matchAll(_CALL_RE)) {
    for (const lit of extractLiterals(m[1])) keys.add(lit);
  }

  // localeFallback(code, "key", "fallback") — second arg is the key.
  for (const m of text.matchAll(LOCALE_FALLBACK_RE)) {
    keys.add(m[2]);
  }

  // NAME_LABEL_KEY = "short" static props.
  for (const m of text.matchAll(STATIC_KEY_RE)) {
    const lit = m[2];
    if (prefix) keys.add(`${prefix}.${lit}`);
    else keys.add(lit);
  }

  // Template literals with ${CONF.name} — extract the suffix after `}`.
  for (const m of text.matchAll(TEMPLATE_KEY_RE)) {
    const template = m[1];
    const match = template.match(/\}\.(\w+)/);
    if (match && prefix) keys.add(`${prefix}.${match[1]}`);
  }

  return keys;
};

const walk = (dir, out = []) => {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === "dist") continue;
      walk(p, out);
    } else if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx")) {
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
