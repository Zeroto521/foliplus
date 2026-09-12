#!/usr/bin/env node
/**
 * Scaffold a new foliplus control and patch every registration point.
 *
 * Usage:
 *   node script/new-control.mjs FooControl --description="..." --position=topleft --icon=⚙
 *   npm run new-control -- FooControl
 *
 * Creates the dual-stack skeleton (Python + TS + CSS + locale) and updates the
 * registries that a control must appear in. Pure helpers are exported for unit
 * tests; the CLI entry is guarded so importing the module has no side effects.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { help, parseArgs } from "./args.mjs";
import { FAIL, OK } from "./glyphs.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

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

/** Valid Leaflet control positions accepted by BaseControl. */
const POSITIONS = new Set(["topleft", "topright", "bottomleft", "bottomright"]);

/** PascalCase name ending in Control. */
const isValidControlName = (name) => /^[A-Z][A-Za-z0-9]*Control$/.test(name);

/** Strip the Control suffix and kebab-case the remainder (ScaleControl → scale). */
const controlSlug = (name) =>
  name.replace(/Control$/, "").replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

/**
 * Split argv into positionals and flag tokens (args.mjs only understands flags).
 * Flag values that do not start with `-` stay attached to their flag.
 */
const splitArgv = (argv, spec = SPEC) => {
  const positional = [];
  const flagTokens = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith("-")) {
      if (!flagTokens.includes(t)) positional.push(t);
      continue;
    }
    flagTokens.push(t);
    const eq = t.indexOf("=");
    const bare = t.replace(/^--?/, "").split("=")[0];
    const meta = spec[bare];
    const isBool = meta?.type === "bool" || t === "-h" || t === "--help";
    if (eq === -1 && !isBool && i + 1 < argv.length && !argv[i + 1].startsWith("-")) {
      flagTokens.push(argv[++i]);
    }
  }
  return { positional, flagTokens };
};

/**
 * Insert a line into a marker-delimited list, keeping alphabetical order when
 * the existing keys sort ahead of the new one.
 */
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

/** Add `from .Name import Name` and a sorted `__all__` entry. */
const patchInitPy = (text, name) => {
  if (text.includes(`from .${name} import ${name}`)) return text;
  const importLine = `from .${name} import ${name}`;
  const afterImports = text.replace(
    /(from \.BaseControl import BaseControl\n)/,
    `$1${importLine}\n`,
  );
  return afterImports.replace(
    /(__all__ = \[\n)([\s\S]*?)(\n\])/,
    (m, head, body, tail) => {
      if (body.includes(`"${name}"`)) return m;
      const items = body
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => l.replace(/,$/, "").replace(/^"|"$/g, ""));
      if (!items.includes(name)) items.push(name);
      items.sort();
      return head + items.map((i) => `    "${i}",`).join("\n") + tail;
    },
  );
};

/** Add `Name: "Name",` to COMPONENTS. */
const patchComponentTs = (text, name) =>
  insertSortedLine(
    text,
    { start: "const COMPONENTS = {", end: "} as const;" },
    `${name}: "${name}",`,
  );

/** Add the control to the api.rst autosummary list. */
const patchApiRst = (text, name) => {
  if (new RegExp(`^\\s+${name}\\s*$`, "m").test(text)) return text;
  return insertSortedLine(text, { start: ".. autosummary::", end: "locale" }, name);
};

/** Append a features-table row after the last `**…Control**` row. */
const patchReadme = (text, name, description, icon = "🧩") => {
  if (text.includes(`**${name}**`)) return text;
  const lines = text.split("\n");
  let last = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\|.*\*\*[A-Za-z]+Control\*\*/.test(lines[i])) last = i;
  }
  if (last < 0) throw new Error("README control table not found");
  const cell1 = `${icon} **${name}**`.padEnd(24);
  const cell2 = ` ${description}`.padEnd(84);
  lines.splice(last + 1, 0, `| ${cell1}|${cell2}|`);
  return lines.join("\n");
};

/** Seed `{Name}.title` into `_JS_USED_KEYS`. */
const patchLocaleKeys = (text, name, key = `${name}.title`) => {
  if (text.includes(`"${key}"`)) return text;
  const marker = `    # ${name}\n    "${key}",\n`;
  const idx = text.indexOf("_JS_USED_KEYS = {");
  if (idx < 0) throw new Error("_JS_USED_KEYS not found");
  const close = text.indexOf("\n}\n", idx);
  if (close < 0) throw new Error("_JS_USED_KEYS closing brace not found");
  return text.slice(0, close + 1) + marker + text.slice(close + 1);
};

/** Build every skeleton file path → content pair for a control. */
const buildSkeleton = ({ name, description, position, icon = "🧩" }) => {
  const slug = controlSlug(name);
  const cssClass = `foliplus-${slug}-ctrl`;
  const localeKey = `${name}.title`;
  const files = new Map();

  files.set(
    `foliplus/${name}.py`,
    `from __future__ import annotations

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class ${name}(BaseControl):
    """${description}

    Parameters
    ----------
    position : str, default "${position}"
        One of "topleft", "topright", "bottomleft", "bottomright".

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import ${name}
    >>> m = folium.Map()
    >>> ${name}().add_to(m)
    """

    _export_fields = ()

    def __init__(
        self,
        *,
        position: Position = "${position}",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template()
`,
  );

  // Import order matches .prettierrc.cjs: #core → #foliplus → #common.
  files.set(
    `foliplus/js/${name}/index.ts`,
    `import { createControlEnv } from "#core/controlEnv.js";
import { BaseControl } from "#foliplus/BaseControl.js";
import { createScopedTranslator } from "#common/locale.js";

// ==================== Runtime Guard ====================
createControlEnv(CONF);
const T = createScopedTranslator(CONF);

// ==================== Control Definition ====================
class ${name} extends BaseControl {
  buildDOM() {
    const root = L.DomUtil.create("div", "leaflet-control ${cssClass}");
    root.textContent = T("title");
    return root;
  }
}

new ${name}({ position: CONF.position }).addTo(map);
`,
  );

  // Tokens must exist in css/common/token.css — never invent new ones here.
  files.set(
    `foliplus/css/${name}.css`,
    `.${cssClass} {
  padding: var(--space-sm) var(--space-md);
  background: var(--ctrl-bg);
  color: var(--text-primary);
  border: var(--border-thin) solid var(--divider-color);
  border-radius: var(--radius-lg);
  font-size: var(--font-size-sm);
}
`,
  );

  for (const [code, label, title] of [
    ["en", "English", description],
    ["zh", "中文", description],
  ]) {
    files.set(
      `foliplus/locale/${name}.${code}.json`,
      JSON.stringify(
        { "locale.name": label, "locale.code": code, [localeKey]: title },
        null,
        2,
      ) + "\n",
    );
  }

  files.set(
    `test/python/test_${name}.py`,
    `"""Tests for ${name}."""

from __future__ import annotations

from conftest import render

from foliplus import ${name}


class Test${name}Python:
    def test_name(self):
        assert ${name}().__class__.__name__ == "${name}"

    def test_default_position(self):
        assert ${name}().position == "${position}"


class Test${name}Rendering:
    def test_default_params(self):
        html = render(${name}())
        assert "${name}" in html
`,
  );

  return { files, slug, cssClass, localeKey, icon };
};

// ── CLI ─────────────────────────────────────────────────────────
/* v8 ignore start -- CLI-only entry point, not exercised by unit tests */
const runCli = () => {
  const ROOT = resolve(__dirname, "..");
  const { positional, flagTokens } = splitArgv(process.argv.slice(2));
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

  if (!isValidControlName(nameArg)) {
    console.error(
      `${FAIL} name must be PascalCase ending in Control (got "${nameArg}")`,
    );
    process.exit(1);
  }

  const position = _raw.position;
  if (!POSITIONS.has(position)) {
    console.error(
      `${FAIL} --position must be one of ${[...POSITIONS].join(", ")} (got "${position}")`,
    );
    process.exit(1);
  }

  const NAME = nameArg;
  const DESCRIPTION = _raw.description || `${NAME} for foliplus maps.`;
  const ICON = _raw.icon;
  const FORCE = Boolean(_raw.force);
  const { files, localeKey } = buildSkeleton({
    name: NAME,
    description: DESCRIPTION,
    position,
    icon: ICON,
  });

  const p = (...parts) => resolve(ROOT, ...parts);
  const rel = (path) =>
    path.replace(/\\/g, "/").replace(ROOT.replace(/\\/g, "/") + "/", "");

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

  const patchFile = (path, mutator) => {
    const raw = readFileSync(path, "utf-8");
    const eol = raw.includes("\r\n") ? "\r\n" : "\n";
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

  for (const [relPath, content] of files) {
    writeIfAbsent(p(...relPath.split("/")), content);
  }

  patchFile(p("foliplus", "__init__.py"), (t) => patchInitPy(t, NAME));
  patchFile(p("foliplus", "js", "core", "component.ts"), (t) =>
    patchComponentTs(t, NAME),
  );
  patchFile(p("doc", "source", "api.rst"), (t) => patchApiRst(t, NAME));
  patchFile(p("README.md"), (t) => patchReadme(t, NAME, DESCRIPTION, ICON));
  // test_build.py derives COMPONENTS from the package — no patch needed.
  // vitest.config.mjs excludes foliplus/js/*/index.ts by glob — no patch needed.
  patchFile(p("test", "python", "test_locale.py"), (t) => patchLocaleKeys(t, NAME));

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
};

export {
  POSITIONS,
  buildSkeleton,
  controlSlug,
  insertSortedLine,
  isValidControlName,
  patchApiRst,
  patchComponentTs,
  patchInitPy,
  patchLocaleKeys,
  patchReadme,
  splitArgv,
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runCli();
}
/* v8 ignore stop */
