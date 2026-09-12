#!/usr/bin/env node
/**
 * Scaffold a new foliplus control and patch every registration point.
 *
 * Usage:
 *   node script/new-control.mjs ScaleControl
 *   node script/new-control.mjs FooControl --description="..." --position=topleft --icon=⚙
 *
 * Creates the dual-stack skeleton (Python + TS + CSS + locale) and updates the
 * registries that a control must appear in. Anything the script cannot safely
 * infer is listed in the post-run checklist.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { help, parseArgs } from "./args.mjs";
import { FAIL, OK } from "./glyphs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const SPEC = {
  help: { type: "bool", short: "h", desc: "Show this help" },
  description: {
    type: "string",
    default: "",
    desc: "One-line control description (README + docstring)",
  },
  position: {
    type: "string",
    default: "topleft",
    desc: "Default Leaflet control position",
  },
  icon: {
    type: "string",
    default: "🧩",
    desc: "README table emoji for this control",
  },
  force: { type: "bool", desc: "Overwrite existing skeleton files" },
};

// Positional name first; args.mjs only understands flags.
const argv = process.argv.slice(2);
const positional = [];
const flagTokens = [];
for (let i = 0; i < argv.length; i++) {
  const t = argv[i];
  if (!t.startsWith("-")) continue; // handled below via rescan
  flagTokens.push(t);
  const eq = t.indexOf("=");
  const bare = t.replace(/^--?/, "").split("=")[0];
  const meta = SPEC[bare];
  const isBool = meta?.type === "bool" || t === "-h" || t === "--help";
  if (eq === -1 && !isBool && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
    flagTokens.push(argv[++i]);
  }
}
for (const t of argv) {
  if (!t.startsWith("-") && !flagTokens.includes(t)) positional.push(t);
}

const _raw = parseArgs(flagTokens, SPEC);
if (_raw.help) {
  console.log(help(SPEC));
  console.log(`
Example:
  node script/new-control.mjs FooControl --description="Foo the map" --icon=🧪`);
  process.exit(0);
}

const nameArg = positional[0];
if (!nameArg || _raw.errors.length) {
  if (_raw.errors.length) console.error(_raw.errors.join("\n"));
  console.error("Usage: node script/new-control.mjs <NameControl> [options]");
  console.error(help(SPEC));
  process.exit(1);
}

const NAME = nameArg;
if (!/^[A-Z][A-Za-z0-9]*Control$/.test(NAME)) {
  console.error(`${FAIL} name must be PascalCase ending in Control (got "${NAME}")`);
  process.exit(1);
}

const DESCRIPTION = _raw.description || `${NAME} for foliplus maps.`;
const POSITION = _raw.position;
const ICON = _raw.icon;
const FORCE = Boolean(_raw.force);

const p = (...parts) => resolve(ROOT, ...parts);
const rel = (path) => path.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/") + "/", "");

const created = [];
const patched = [];
const skipped = [];

const writeIfAbsent = (path, content) => {
  if (existsSync(path) && !FORCE) {
    skipped.push(rel(path));
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
  created.push(rel(path));
  return true;
};

/** Insert a line into a sorted-ish list, keeping alphabetical order when possible. */
const insertSortedLine = (text, block, line) => {
  if (text.includes(line)) return text;
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === block.start);
  if (start < 0) throw new Error(`marker not found: ${block.start}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].includes(block.end)) end++;
  if (end >= lines.length) throw new Error(`end marker not found: ${block.end}`);

  const body = lines.slice(start + 1, end);
  const indent = (body.find((l) => l.trim()) ?? "  ").match(/^\s*/)?.[0] ?? "  ";
  const newLine = indent + line;
  let insertAt = end;
  for (let i = start + 1; i < end; i++) {
    const cur = lines[i].trim();
    if (!cur || cur.startsWith("#") || cur.startsWith("//")) continue;
    const curKey = cur.replace(/^["'{\s]+/, "").split(/[:"'\s]/)[0];
    const newKey = line.replace(/^["'{\s]+/, "").split(/[:"'\s]/)[0];
    if (curKey.localeCompare(newKey) > 0) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, newLine);
  return lines.join("\n");
};

const patchFile = (path, mutator) => {
  const raw = readFileSync(path, "utf-8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  // Normalize to LF so regex/marker patches work regardless of checkout eol.
  const before = raw.replace(/\r\n/g, "\n");
  let after;
  try {
    after = mutator(before);
  } catch (err) {
    console.error(`${FAIL} patch failed: ${rel(path)}`);
    throw err;
  }
  if (after === before) {
    if (!before.includes(NAME)) skipped.push(rel(path) + " (already present)");
    return;
  }
  writeFileSync(path, after.replace(/\n/g, eol), "utf-8");
  patched.push(rel(path));
};

// ── 1. Python control ──────────────────────────────────────────
writeIfAbsent(
  p("foliplus", `${NAME}.py`),
  `from __future__ import annotations

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class ${NAME}(BaseControl):
    """${DESCRIPTION}

    Parameters
    ----------
    position : str, default "${POSITION}"
        One of "topleft", "topright", "bottomleft", "bottomright".

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import ${NAME}
    >>> m = folium.Map()
    >>> ${NAME}().add_to(m)
    """

    _export_fields = ()

    def __init__(
        self,
        *,
        position: Position = "${POSITION}",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template()
`,
);

// ── 2. JS entry ────────────────────────────────────────────────
writeIfAbsent(
  p("foliplus", "js", NAME, "index.ts"),
  `import { BaseControl } from "#foliplus/BaseControl.js";
import { createControlEnv } from "#common/guard.js";
import { createScopedTranslator } from "#common/locale.js";

// ==================== Runtime Guard ====================
createControlEnv(CONF);
const T = createScopedTranslator(CONF);

// ==================== Control Definition ====================
class ${NAME} extends BaseControl {
  buildDOM() {
    const root = L.DomUtil.create("div", "leaflet-control foliplus-${NAME
      .replace(/Control$/, "")
      .toLowerCase()}-ctrl");
    root.textContent = T("title");
    return root;
  }
}

new ${NAME}({ position: CONF.position }).addTo(map);
`,
);

// ── 3. CSS ─────────────────────────────────────────────────────
const cssClass = `foliplus-${NAME.replace(/Control$/, "").toLowerCase()}-ctrl`;
writeIfAbsent(
  p("foliplus", "css", `${NAME}.css`),
  `.${cssClass} {
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-panel);
  color: var(--text-primary);
  border: var(--border-thin) solid var(--border-default);
  border-radius: var(--radius-md);
  font-size: var(--font-sm);
}
`,
);

// ── 4. Locale ──────────────────────────────────────────────────
const localeKey = `${NAME}.title`;
for (const [code, label, title] of [
  ["en", "English", DESCRIPTION],
  ["zh", "中文", DESCRIPTION],
]) {
  writeIfAbsent(
    p("foliplus", "locale", `${NAME}.${code}.json`),
    JSON.stringify(
      {
        "locale.name": label,
        "locale.code": code,
        [localeKey]: title,
      },
      null,
      2,
    ) + "\n",
  );
}

// ── 5. Minimal Python test ─────────────────────────────────────
writeIfAbsent(
  p("test", "python", `test_${NAME}.py`),
  `"""Tests for ${NAME}."""

from __future__ import annotations

from conftest import render

from foliplus import ${NAME}


class Test${NAME}Python:
    def test_name(self):
        assert ${NAME}().__class__.__name__ == "${NAME}"

    def test_default_position(self):
        assert ${NAME}().position == "${POSITION}"


class Test${NAME}Rendering:
    def test_default_params(self):
        html = render(${NAME}())
        assert "${NAME}" in html
`,
);

// ── 6. Patch registries ────────────────────────────────────────
patchFile(p("foliplus", "__init__.py"), (text) => {
  if (text.includes(`from .${NAME} import ${NAME}`)) return text;
  const importLine = `from .${NAME} import ${NAME}`;
  const afterImports = text.replace(
    /(from \.BaseControl import BaseControl\n)/,
    `$1${importLine}\n`,
  );
  // keep __all__ alphabetical
  return afterImports.replace(
    /(__all__ = \[\n)([\s\S]*?)(\n\])/,
    (m, head, body, tail) => {
      if (body.includes(`"${NAME}"`)) return m;
      const items = body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/,$/, "").replace(/^"|"$/g, ""));
      if (!items.includes(NAME)) items.push(NAME);
      items.sort();
      const rendered = items.map((i) => `    "${i}",`).join("\n");
      return head + rendered + tail;
    },
  );
});

patchFile(p("foliplus", "js", "core", "component.ts"), (text) => {
  if (text.includes(`${NAME}: "${NAME}"`)) return text;
  return insertSortedLine(
    text,
    { start: "const COMPONENTS = {", end: "} as const;" },
    `${NAME}: "${NAME}",`,
  );
});

patchFile(p("doc", "source", "api.rst"), (text) => {
  if (new RegExp(`^\\s+${NAME}\\s*$`, "m").test(text)) return text;
  return insertSortedLine(
    text,
    { start: ".. autosummary::", end: "locale" },
    NAME,
  );
});

patchFile(p("README.md"), (text) => {
  if (text.includes(`**${NAME}**`)) return text;
  const row = `| ${ICON} **${NAME}**`.padEnd(25) + `| ${DESCRIPTION}`.padEnd(84) + "|";
  // insert before the last table row (keep alphabetical by name inside emoji rows is hard —
  // append after the last `| ...Control` row)
  const lines = text.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\|.*\*\*[A-Za-z]+Control\*\*/.test(lines[i])) last = i;
  }
  if (last < 0) throw new Error("README control table not found");
  lines.splice(last + 1, 0, row);
  return lines.join("\n");
});

// test_build.py derives COMPONENTS from the package — no patch needed.
// vitest.config.mjs excludes foliplus/js/*/index.ts by glob — no patch needed.

patchFile(p("test", "python", "test_locale.py"), (text) => {
  if (text.includes(`"${localeKey}"`)) return text;
  const marker = `    # ${NAME}\n    "${localeKey}",\n`;
  const idx = text.indexOf("_JS_USED_KEYS = {");
  if (idx < 0) throw new Error("_JS_USED_KEYS not found");
  // Close of the set literal: a line that is exactly "}".
  const close = text.indexOf("\n}\n", idx);
  if (close < 0) throw new Error("_JS_USED_KEYS closing brace not found");
  return text.slice(0, close + 1) + marker + text.slice(close + 1);
});

// ── 7. Checklist ───────────────────────────────────────────────
console.log(`${OK} scaffolded ${NAME}\n`);
if (created.length) {
  console.log("Created:");
  for (const f of created) console.log(`  + ${f}`);
}
if (patched.length) {
  console.log("\nPatched:");
  for (const f of patched) console.log(`  ~ ${f}`);
}
if (skipped.length) {
  console.log("\nSkipped (already present):");
  for (const f of skipped) console.log(`  · ${f}`);
}
console.log(`
Manual next steps:
  1. Implement buildDOM() / __init__ kwargs / _export_fields as needed
  2. Add real locale strings to foliplus/locale/${NAME}.{en,zh}.json
     and keep test/python/test_locale.py::_JS_USED_KEYS in sync
  3. If the control participates in mode locking or EventBus, register it in
     foliplus/js/core/mode.ts and foliplus/js/core/event/const.ts
  4. If the control exposes a typed CONF shape, extend foliplus/js/type/global.d.ts
  5. Run: make build-js-dev && make test-python && npm test
`);
