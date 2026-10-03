#!/usr/bin/env node
/**
 * Generate `foliplus/js/config-schema.ts` from the schema dump JSON.
 *
 * Reads the output of `python foliplus/_config_schema.py --dump` (or a file with
 * the same JSON) and writes a TypeScript module that declares:
 *
 *   - `ConfigCommon` — the base fields every control emits (name, position,
 *     locale_tables, locale_code).
 *   - Per-control interfaces (`ConfigFullscreen`, `ConfigScale`, …)
 *     with that control's declared fields as required (per the schema's
 *     `optional` flag).
 *   - `ConfigRuntimeOnly` — fields JS sets at runtime; Python never emits.
 *   - `ComponentConfig` — the flat merged interface for backward
 *     compatibility with the existing `global.d.ts` shape. All fields are
 *     optional except `name`, plus a `[key: string]: unknown` escape hatch.
 *
 * The generated file is the single TS-side declaration surface for the CONFIG
 * contract. `global.d.ts` imports `ComponentConfig` from here instead of
 * defining it inline, so drift between Python and TS is a typecheck error
 * rather than a silent `unknown`.
 *
 * Usage: node script/build/emit-config-schema.mjs [--json <path>] [--out <path>] [--verify]
 *
 * Reads <path> (default: stdin), writes <path> (default:
 * foliplus/js/config-schema.ts). Run by script/build/build.mjs as part of the JS
 * build (with --verify, which never writes); also runnable standalone for
 * local iteration.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { format, resolveConfig } from "prettier";
import { pathToFileURL } from "url";
import { help, parseArgs } from "../args.mjs";
import { repoRoot } from "../build-path.mjs";

// `format()` does not load the repo config on its own, so bare defaults would
// produce a file that `format:check` (printWidth 88 + the import-sort plugin)
// rejects. Resolved once at import; empty when no config is found.
//
// The argument must be a *file* path, not a directory: resolveConfig() looks
// up from the directory *containing* the path, so a directory argument skips
// that directory. That made this accidentally resolve the parent checkout's
// config locally (a worktree's parent is another checkout of this repo) while
// resolving nothing in CI, where format() ran on bare prettier defaults and
// emitted output the import-sort plugin had not produced. The build's
// byte-exact verify then failed with a misleading "out of date" message that
// pointed at _config_schema.py. Anchoring on package.json puts a file in the repo
// root, next to .prettierrc.cjs, so discovery reaches the config format:check
// uses.
const PrettierOptions =
  (await resolveConfig(resolve(repoRoot(import.meta.url), "package.json"), {
    editorconfig: false,
  })) ?? {};

const SPEC = {
  json: {
    type: "string",
    desc: "Path to the schema dump JSON (default: read from stdin)",
  },
  out: {
    type: "string",
    default: resolve(repoRoot(import.meta.url), "foliplus/js/config-schema.ts"),
    desc: "Output path for the generated TS file",
  },
  verify: {
    type: "bool",
    desc: "Don't write; compare against --out and fail if the committed file is stale",
  },
};

const _raw = parseArgs(process.argv.slice(2), SPEC);
if (_raw.help) {
  console.log(help(SPEC));
  process.exit(0);
}
if (_raw.errors.length) {
  console.error(_raw.errors.join("\n"));
  console.error(help(SPEC));
  process.exit(1);
}
const opts = _raw;

// ── Type tag → TS type mapping ────────────────────────────────────────────
// Kept in sync with foliplus/_config_schema.py's _TS_PRIMITIVES and _TS_OBJECTS.
// Adding a new tag there without adding it here is caught by the
// `unknown_tag` error below, which fails the build loudly.
//
// Tags are TS type names: a tag that is a name renders as that name, so
// `NumberStyle` → `NumberStyle` rather than `number_style` → `NumberStyle`.
// The three primitives that are not names (`bool` → `boolean`, `any` →
// `unknown`, `null` → `null`) stay spelled as their Python-side form.

const PRIMITIVES = new Set(["bool", "number", "string", "null", "any"]);
const OBJECTS = new Set([
  "object",
  "object_string",
  "object_nested",
  "array_string",
  "array_unknown",
  "ControlPosition",
  // Inline union, not a name — mirrors _TS_OBJECTS on the Python side, and is
  // deliberately absent from IMPORTS (there is nothing to import for it).
  "string | ProviderConfig",
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
  ControlPosition: "ControlPosition",
  // Not a name: the SearchControl `provider` field is a union of a built-in
  // provider id and a custom ProviderConfig dict. Python has no alias to
  // name that union, so the tag renders it inline. Kept out of IMPORTS and
  // of the Python↔TS name check for exactly this reason.
  "string | ProviderConfig": "string | ProviderConfig",
};

/** Names imported from other modules in the generated file. Mirrored by
 *  foliplus/_config_schema.py's IMPORTS; the Python side checks that every
 *  tag which renders as a name appears here, so a rename on one side fails
 *  the dump instead of emitting an unimported type. */
const IMPORTS = [{ name: "ControlPosition", from: "leaflet" }];

/** Render a shape descriptor (from FieldSpec.shape) as a TS type.
 *
 * Shape grammar (validated by _validate_shape on the Python side):
 *   - "string" / "number" / "bool" / "null" → TS primitive
 *   - null → TS null
 *   - ["a", "b", ...] (all strings) → literal union
 *   - [X, "?"] → optional field marker (dict value only)
 *   - [[...]] or [{...}] → array (item is the first element)
 *   - {"*": V} → Record<string, V>
 *   - {name: V} → object with named keys
 *
 * JSON serializes Python tuples as lists, so the JS side disambiguates:
 * length-2 with "?" → optional marker; all-strings → union; otherwise → array.
 */
const renderShape = (x, path = "") => {
  if (x === null) return "null";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) {
    if (x.length === 2 && x[1] === "?") {
      throw new Error(
        `Optional marker (X, "?") at ${path} is only valid as a dict value`,
      );
    }
    if (x.every(v => typeof v === "string")) {
      return x.map(v => `"${v}"`).join(" | ");
    }
    return renderShape(x[0], `${path}[0]`) + "[]";
  }
  if (typeof x === "object") {
    const keys = Object.keys(x);
    if (keys.length === 1 && keys[0] === "*") {
      return `Record<string, ${renderShape(x["*"], `${path}.*`)}>`;
    }
    return (
      "{ " +
      keys
        .map(k => {
          const v = x[k];
          if (Array.isArray(v) && v.length === 2 && v[1] === "?") {
            return `${k}?: ${renderShape(v[0], `${path}.${k}`)}`;
          }
          return `${k}: ${renderShape(v, `${path}.${k}`)}`;
        })
        .join("; ") +
      " }"
    );
  }
  throw new Error(`Unknown shape type at ${path}: ${typeof x}`);
};

/** Render one field's TS type, including nullable suffix.
 *
 * When the field carries a `name` (a generated alias), the rendered base
 * type is the name — the alias definition is emitted elsewhere by
 * buildConfigSchema. This covers both shape-driven types (complex objects/
 * arrays) and union-driven types (literal unions like NumberStyle).
 */
const renderType = field => {
  let base;
  if (field.name) {
    base = field.name;
  } else if (field.ts === "union") {
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

/** Above this length a note becomes a JSDoc block above the field instead of
 *  a trailing comment — a 90-char trailing comment wraps badly, and dropping
 *  the note was silent data loss. */
const TRAILING_NOTE_MAX = 60;

/** Format one field as one or two TS lines: a JSDoc block for a long or
 *  multi-line note, then the property line. A short single-line note is a
 *  trailing comment on the property line itself. */
const formatField = (name, field, indent = "  ") => {
  const opt = field.optional ? "?" : "";
  const type = renderType(field);
  const line = `${indent}${name}${opt}: ${type};`;
  if (!field.note) return [line];
  if (field.note.length <= TRAILING_NOTE_MAX && !field.note.includes("\n")) {
    return [`${line} // ${field.note}`];
  }
  return [`${indent}/** ${field.note.trim()} */`, line];
};

/** Emit a TS interface from a schema dict. Per-control interfaces extend
 *  ConfigCommon so a CONFIG literal carrying shared fields type-checks; shared
 *  and runtime-only interfaces are standalone. */
const emitInterface = (name, schema, { extendsShared = false, indent = "" } = {}) => {
  const head = extendsShared ? `${name} extends ConfigCommon` : name;
  const lines = [`${indent}interface ${head} {`];
  for (const [fieldName, field] of Object.entries(schema)) {
    lines.push(...formatField(fieldName, field, indent + "  "));
  }
  lines.push(`${indent}}`);
  return lines;
};

// ── Core (exported for unit tests) ─────────────────────────────────────────

/** Collect generated named types from the schema. Each entry is a
 *  FieldSpec with a `name` — either shape-driven (complex types) or
 *  union-driven (literal unions like NumberStyle). Returns a Map of
 *  name → rendered TS type. */
const collectNamedTypes = schema => {
  const named = new Map();
  const visit = fields => {
    for (const field of Object.values(fields)) {
      if (!field.name) continue;
      if (field.shape) {
        named.set(field.name, renderShape(field.shape, field.name));
      } else if (field.ts === "union" && field.values) {
        named.set(field.name, field.values.map(v => `"${v}"`).join(" | "));
      }
    }
  };
  visit(schema.shared);
  visit(schema.runtime_only);
  for (const controlSchema of Object.values(schema.controls)) {
    visit(controlSchema);
  }
  return named;
};

/** Generate the config-schema.ts text for one parsed schema JSON object.
 *  Formatted through Prettier with the repo config so the output byte-matches
 *  what format:check enforces on the committed file. */
const buildConfigSchema = async schema => {
  const namedTypes = collectNamedTypes(schema);

  const lines = [
    "// AUTO-GENERATED by script/build/emit-config-schema.mjs from foliplus/_config_schema.py.",
    "// Do not edit by hand — regenerate with:",
    "//   python foliplus/_config_schema.py --out foliplus/.build/js/config-schema.json",
    "//   node script/build/emit-config-schema.mjs --json foliplus/.build/js/config-schema.json",
    "",
    "// Per-control CONFIG interfaces plus a flat ComponentConfig for backward",
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

  // Named type aliases — generated from FieldSpec.name + shape/values.
  // Declared without `export` and re-exported in the single export block at
  // the bottom: the eslint rule no-restricted-syntax forbids inline
  // `export type X = ...` declarations.
  for (const [name, type] of namedTypes) {
    lines.push(`type ${name} = ${type};`);
  }
  if (namedTypes.size > 0) lines.push("");

  // Shared interface
  lines.push(...emitInterface("ConfigCommon", schema.shared), "");

  // Per-control interfaces
  for (const [controlName, controlSchema] of Object.entries(schema.controls)) {
    const interfaceName = `Config${controlName.replace("Control", "")}`;
    lines.push(
      ...emitInterface(interfaceName, controlSchema, { extendsShared: true }),
      "",
    );
  }

  // Runtime-only interface
  lines.push(...emitInterface("ConfigRuntimeOnly", schema.runtime_only), "");

  // Flat ComponentConfig — all fields optional except `name`, plus escape hatch.
  // This matches the existing global.d.ts shape so existing code continues to
  // compile. Per-control interfaces above are stricter and available for new
  // code that wants to type-check against a specific control's schema.
  lines.push(
    "/** Flat CONFIG type for all controls. All fields optional except `name`. */",
    "interface ComponentConfig {",
  );

  // Collect all fields from shared + runtime_only + all controls, deduplicated.
  // Order: shared first, then controls alphabetically, then runtime_only last.
  const seen = new Set();
  const mergedFields = [];

  // `seen` is empty on first entry, and a schema object cannot repeat a key,
  // so the guard below can never be false here.
  for (const [name, field] of Object.entries(schema.shared)) {
    /* v8 ignore next -- unreachable: `seen` is empty here and keys are unique */
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
    lines.push(...formatField(name, mergedField, "  "));
  }

  lines.push("  /** Escape hatch for truly dynamic keys not in the schema. */");
  lines.push("  [key: string]: unknown;");
  lines.push("}");
  lines.push("");

  // Single export at the bottom (codebase lint rule: no inline exports).
  // Generated named aliases come first — they are declared above but only
  // exported here, along with the interfaces.
  const allTypes = [
    ...namedTypes.keys(),
    "ConfigCommon",
    ...Object.keys(schema.controls).map(n => `Config${n.replace("Control", "")}`),
    "ConfigRuntimeOnly",
    "ComponentConfig",
  ];
  lines.push(`export type { ${allTypes.join(", ")} };`);
  lines.push("");

  return format(lines.join("\n"), { ...PrettierOptions, parser: "typescript" });
};

// ── CLI entry ──────────────────────────────────────────────────────────────

/** Read the schema JSON, render the TS, then write or verify `out`.
 *  `o` is injectable so tests can drive every branch against temp paths. */
const main = async (o = opts) => {
  let jsonText;
  if (o.json) {
    jsonText = readFileSync(resolve(o.json), "utf-8");
  } else {
    /* v8 ignore next -- stdin fallback; the build always passes --json */
    jsonText = readFileSync(0, "utf-8");
  }

  const text = await buildConfigSchema(JSON.parse(jsonText));

  // `--verify` is what the JS build calls: the generated content must equal the
  // committed file, or the build fails loudly instead of silently rewriting a
  // committed source artifact. Writing mode stays for manual regeneration.
  // CRLF is normalized before the comparison: git's autocrlf re-emits CRLF on
  // Windows checkouts while prettier emits LF, so a raw byte compare failed
  // locally and passed in CI.
  if (o.verify) {
    const existing = readFileSync(o.out, "utf-8").replace(/\r\n/g, "\n");
    if (existing !== text) {
      console.error(
        "foliplus/js/config-schema.ts is out of date with foliplus/_config_schema.py. " +
          "Regenerate with:",
      );
      console.error(
        "  python foliplus/_config_schema.py --out foliplus/.build/js/config-schema.json",
      );
      console.error(
        "  node script/build/emit-config-schema.mjs --json foliplus/.build/js/config-schema.json",
      );
      process.exit(1);
    }
  } else {
    writeFileSync(o.out, text, "utf-8");
  }
};

export {
  PrettierOptions,
  buildConfigSchema,
  main,
  RENDER,
  IMPORTS,
  PRIMITIVES,
  OBJECTS,
};

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await main();
}
