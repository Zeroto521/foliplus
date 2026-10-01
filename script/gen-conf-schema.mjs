#!/usr/bin/env node
/**
 * Generate `foliplus/js/conf-schema.ts` from the schema dump JSON.
 *
 * Reads the output of `python foliplus/_schema.py --dump` (or a file with
 * the same JSON) and writes a TypeScript module that declares:
 *
 *   - `ConfShared` — the base fields every control emits (name, position,
 *     locale_tables, locale_code).
 *   - Per-control interfaces (`ConfFullscreen`, `ConfScale`, …)
 *     with that control's declared fields as required (per the schema's
 *     `optional` flag).
 *   - `ConfRuntimeOnly` — fields JS sets at runtime; Python never emits.
 *   - `ComponentConfig` — the flat merged interface for backward
 *     compatibility with the existing `global.d.ts` shape. All fields are
 *     optional except `name`, plus a `[key: string]: unknown` escape hatch.
 *
 * The generated file is the single TS-side declaration surface for the CONF
 * contract. `global.d.ts` imports `ComponentConfig` from here instead of
 * defining it inline, so drift between Python and TS is a typecheck error
 * rather than a silent `unknown`.
 *
 * Usage:
 *   node script/gen-conf-schema.mjs [--json <path>] [--out <path>]
 *
 * Reads <path> (default: stdin), writes <path> (default:
 * foliplus/js/conf-schema.ts). Run by script/build.mjs as part of the JS
 * build; also runnable standalone for local iteration.
 */
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { parseArgs } from "./args.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SPEC = {
  json: {
    type: "string",
    desc: "Path to the schema dump JSON (default: read from stdin)",
  },
  out: {
    type: "string",
    default: resolve(__dirname, "..", "foliplus/js/conf-schema.ts"),
    desc: "Output path for the generated TS file",
  },
};

const _raw = parseArgs(process.argv.slice(2), SPEC);
/* v8 ignore start -- CLI-only help/error handling */
if (_raw.help) {
  console.log("Usage: node script/gen-conf-schema.mjs [--json <path>] [--out <path>]");
  process.exit(0);
}
if (_raw.errors.length) {
  console.error(_raw.errors.join("\n"));
  process.exit(1);
}
/* v8 ignore stop */
const opts = _raw;

// ── Type tag → TS type mapping ────────────────────────────────────────────
// Kept in sync with foliplus/_schema.py's _TS_PRIMITIVES and _TS_OBJECTS.
// Adding a new tag there without adding it here is caught by the
// `unknown_tag` error below, which fails the build loudly.

const PRIMITIVES = new Set(["bool", "number", "string", "null", "any"]);
const OBJECTS = new Set([
  "object",
  "object_string",
  "object_nested",
  "array_string",
  "array_unknown",
  "provider",
  "locale_tables",
  "number_style",
  "layer_data",
  "control_position",
]);

const RENDER = {
  bool: "boolean",
  number: "number",
  string: "string",
  null: "null",
  any: "unknown",
  object: "Record<string, unknown>",
  object_string: "Record<string, string>",
  object_nested: "Record<string, Record<string, string>>",
  array_string: "string[]",
  array_unknown: "unknown[]",
  provider: "string | ProviderConfig",
  locale_tables: "LocaleTables",
  number_style: "NumberStyle",
  layer_data: 'Array<{ name: string; id: string; group: "base" | "overlay" }>',
  control_position: "ControlPosition",
};

/** Names imported from other modules in the generated file. */
const IMPORTS = [
  { name: "ControlPosition", from: "leaflet" },
  { name: "LocaleTables", from: "#common/locale.js" },
  { name: "NumberStyle", from: "#common/format.js" },
  { name: "ProviderConfig", from: "#core/geocode/type.js" },
];

/** Render one field's TS type, including nullable suffix. */
const renderType = field => {
  let base;
  if (field.ts === "union") {
    if (!field.values?.length) {
      throw new Error(`Field with ts='union' must have non-empty values`);
    }
    base = field.values.map(v => `"${v}"`).join(" | ");
  } else if (PRIMITIVES.has(field.ts)) {
    base = RENDER[field.ts];
  } else if (OBJECTS.has(field.ts)) {
    base = RENDER[field.ts];
  } else {
    throw new Error(`Unknown FieldSpec.ts tag: ${JSON.stringify(field.ts)}`);
  }
  if (field.nullable) {
    return `${base} | null`;
  }
  return base;
};

/** Format one field as a TS property line. */
const formatField = (name, field, indent = "  ") => {
  const opt = field.optional ? "?" : "";
  const type = renderType(field);
  let line = `${indent}${name}${opt}: ${type};`;
  if (field.note) {
    // Multi-line notes are rare; single-line notes become a trailing comment.
    if (field.note.length <= 60 && !field.note.includes("\n")) {
      line += ` // ${field.note}`;
    }
  }
  return line;
};

/** Emit a TS interface from a schema dict. */
const emitInterface = (name, schema, indent = "") => {
  const lines = [`${indent}interface ${name} {`];
  for (const [fieldName, field] of Object.entries(schema)) {
    lines.push(formatField(fieldName, field, indent + "  "));
  }
  lines.push(`${indent}}`);
  return lines;
};

// ── Main ──────────────────────────────────────────────────────────────────

let jsonText;
if (opts.json) {
  jsonText = readFileSync(resolve(opts.json), "utf-8");
} else {
  jsonText = readFileSync(0, "utf-8"); // 0 = stdin
}

const schema = JSON.parse(jsonText);

const lines = [
  "// AUTO-GENERATED by script/gen-conf-schema.mjs from foliplus/_schema.py.",
  "// Do not edit by hand — regenerate with:",
  "//   python foliplus/_schema.py --out schema.json",
  "//   node script/gen-conf-schema.mjs --json schema.json",
  "",
  "// Per-control CONF interfaces plus a flat ComponentConfig for backward",
  "// compatibility with the existing global.d.ts shape. All fields are",
  "// optional in ComponentConfig (any control may omit any field); per-",
  "// control interfaces are stricter and use the schema's optional flag.",
  "",
];

// Imports
for (const imp of IMPORTS) {
  lines.push(`import type { ${imp.name} } from "${imp.from}";`);
}
lines.push("");

// Shared interface
lines.push(...emitInterface("ConfShared", schema.shared), "");

// Per-control interfaces
for (const [controlName, controlSchema] of Object.entries(schema.controls)) {
  const interfaceName = `Conf${controlName.replace("Control", "")}`;
  lines.push(...emitInterface(interfaceName, controlSchema), "");
}

// Runtime-only interface
lines.push(...emitInterface("ConfRuntimeOnly", schema.runtime_only), "");

// Flat ComponentConfig — all fields optional except `name`, plus escape hatch.
// This matches the existing global.d.ts shape so existing code continues to
// compile. Per-control interfaces above are stricter and available for new
// code that wants to type-check against a specific control's schema.
lines.push(
  "/** Flat CONF type for all controls. All fields optional except `name`. */",
  "interface ComponentConfig {",
);

// Collect all fields from shared + runtime_only + all controls, deduplicated.
// Order: shared first, then controls alphabetically, then runtime_only last.
const seen = new Set();
const mergedFields = [];

for (const [name, field] of Object.entries(schema.shared)) {
  if (!seen.has(name)) {
    seen.add(name);
    mergedFields.push([name, field]);
  }
}

for (const controlName of Object.keys(schema.controls)) {
  for (const [name, field] of Object.entries(schema.controls[controlName])) {
    if (!seen.has(name)) {
      seen.add(name);
      mergedFields.push([name, field]);
    }
  }
}

for (const [name, field] of Object.entries(schema.runtime_only)) {
  if (!seen.has(name)) {
    seen.add(name);
    mergedFields.push([name, field]);
  }
}

for (const [name, field] of mergedFields) {
  // Override optionality: in the flat merged type, all fields except `name`
  // are optional (matching the existing global.d.ts contract).
  const effectiveOptional = name !== "name";
  const mergedField = { ...field, optional: effectiveOptional };
  lines.push(formatField(name, mergedField, "  "));
}

lines.push("  /** Escape hatch for truly dynamic keys not in the schema. */");
lines.push("  [key: string]: unknown;");
lines.push("}");
lines.push("");

// Single export at the bottom (codebase lint rule: no inline exports).
const allTypes = [
  "ConfShared",
  ...Object.keys(schema.controls).map(n => `Conf${n.replace("Control", "")}`),
  "ConfRuntimeOnly",
  "ComponentConfig",
];
lines.push(`export type { ${allTypes.join(", ")} };`);
lines.push("");

writeFileSync(opts.out, lines.join("\n"), "utf-8");
