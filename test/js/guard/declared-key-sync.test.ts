// test/js/guard/declared-key-sync — the declared-key vocabulary twin guard.
//
// The per-layer `foliplus={...}` namespace keys an author may declare are a
// CROSS-STACK vocabulary: the Python declaration side reads them off
// layer.options.foliplus (foliplus/_declaration/key.py) and normalises them into
// CONF, and the JS panel readers consume the same names through the shared
// readDeclaredKey skeleton. This guard pins the two stacks together:
//
//   * the JS single source is control/LayerControl/declared/keys.ts
//     (DECLARED_KEY) and the Python single source is _declaration/key.py
//     (*_KEY constants) — the two value SETS must be equal, derived from the
//     source, never a hand-copied list;
//   * a bare declaration-key string literal in a READ position (declared/,
//     fold/, _declaration/) is a regression toward the old hand-written
//     strings — the guard flags it. Definition sites (the DECLARED_KEY /
//     *_KEY assignments), comments, and the nested face/fill/border/label/
//     filter sub-key tables are exempt.
//
// Tree guard, not a script module: registered under GUARD_TREE_SUBJECTS.
import { readSource } from "./crossLangLiteral.js";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

/** The top-level declaration keys (the foliplus={...} namespace keys). The ONE
 *  vocabulary the guard pins across stacks. `opacity` doubles as a fill
 *  sub-key, so its bare literal is exempt inside the fill declaration modules
 *  (see OPACITY_SUBKEY_ALLOW_FILES). */
const TOP_LEVEL_KEYS = [
  "fill",
  "border",
  "opacity",
  "label",
  "filter",
  "icon",
  "marker",
  "icon_size",
  "marker_color",
  "zoom_range",
  "folder",
] as const;

/** The role words — part of the declaration vocabulary the fold readers use. */
const ROLE_WORDS = ["overlay", "base"] as const;

/** `opacity` is both a top-level declaration key AND the fill declaration's
 *  opacity sub-key (a number from 0 to 1). The bare `"opacity"` literal in the
 *  fill declaration schema (fill.ts / fill.py) is the SUB-KEY, not a top-level
 *  read — allow it there, flag it everywhere else (a top-level opacity read must
 *  use DECLARED_KEY.OPACITY / OPACITY_KEY). */
const OPACITY_SUBKEY_FILES = [
  "foliplus/js/control/LayerControl/declared/fill.ts",
  "foliplus/_declaration/fill.py",
] as const;

/** The directories the guard scans for bare declaration-key literals. */
const SCAN_ROOTS = [
  "foliplus/js/control/LayerControl/declared",
  "foliplus/js/control/LayerControl/fold",
  "foliplus/_declaration",
] as const;

/** Pull the declaration-key value set out of the JS DECLARED_KEY object. */
const jsDeclaredKeys = (): string[] => {
  const src = readSource("foliplus/js/control/LayerControl/declared/declared-key.ts");
  const body = src.match(/const DECLARED_KEY = \{([\s\S]*?)\} as const;/);
  if (!body) {
    throw new Error("declared-key-sync: could not locate JS DECLARED_KEY object");
  }
  return [...body[1].matchAll(/\b[A-Z_]+:\s*"([^"]+)"/g)].map(m => m[1]);
};

/** Pull the declaration-key value set out of the Python *_KEY constants. */
const pyDeclaredKeys = (): string[] => {
  const src = readSource("foliplus/_declaration/key.py");
  const out: string[] = [];
  // Every *_KEY = "value" constant that is a declaration key (not a bound or a
  // measure-type field). The value is a plain string literal.
  for (const m of src.matchAll(/^([A-Z_]+_KEY)\s*=\s*"([^"]+)"/gm)) {
    const name = m[1];
    if (name === "MEASURE_TYPE_FIELD") continue; // not a foliplus namespace key
    out.push(m[2]);
  }
  return out;
};

/** Strip line comments, block comments and Python docstrings crudely so only
 *  code remains. A Python docstring (`"""..."""` / `'''...'''`) is documentation,
 *  not a declaration-key read — the `{"icon": {...}}` prose in face.py is exactly
 *  the false positive a bare-literal scan must not flag. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/#[^\n]*/g, "")
    .replace(/"""[\s\S]*?"""/g, "")
    .replace(/'''[\s\S]*?'''/g, "");

/** Is this line a definition site for a declaration key? A definition writes
 *  `NAME: "key"` (JS object) or `NAME_KEY = "key"` (Python constant), or is a
 *  line inside the face/fill/border/label/filter sub-key tables. */
const isDefinitionSite = (line: string, key: string): boolean =>
  // JS object member: FILL: "fill"
  new RegExp(`\\b[A-Z_]+\\s*:\\s*"${key}"`).test(line) ||
  // Python constant: FILL_KEY = "fill"
  new RegExp(`^\\s*[A-Z_]+_KEY\\s*=\\s*"${key}"`).test(line) ||
  // Sub-key table entry: "glyph": ("glyph",) or glyph: { spellings: ["glyph"] }
  new RegExp(`\\b"${key}"\\s*:`).test(line) ||
  new RegExp(`\\b${key}\\s*:`).test(line);

/** Is `"key"` a type-level union annotation (`: "fill" | "border"`) rather
 *  than a runtime value? A type annotation is not a declaration-key read — the
 *  guard targets the runtime literals the readers hand to readDeclaredKey /
 *  rejectKey, not the `scope: "fill" | "border"` type the parser declares. */
const isTypeAnnotationLiteral = (line: string, key: string): boolean =>
  new RegExp(`(?:\\b[a-zA-Z][a-zA-Z0-9_]*\\s*:|\\|)\\s*"${key}"`).test(line);

/** Walk a directory recursively for source files. */
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|py)$/.test(name)) out.push(full);
  }
  return out;
};

describe("declared-key vocabulary stays in step across Python and JS", () => {
  it("carries the same declaration-key set on both sides", () => {
    const js = [...jsDeclaredKeys()].sort();
    const py = [...pyDeclaredKeys()].sort();
    expect(js, "JS DECLARED_KEY set").toEqual([...TOP_LEVEL_KEYS].sort());
    expect(py, "Python *_KEY set").toEqual(js);
  });

  it("flags a bare declaration-key literal in a read position", () => {
    const hits: string[] = [];
    for (const rootRel of SCAN_ROOTS) {
      const root = resolve(REPO_ROOT, rootRel);
      for (const file of walk(root)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        const src = stripComments(readFileSync(file, "utf8"));
        const lines = src.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const lineNo = i + 1;
          for (const key of [...TOP_LEVEL_KEYS, ...ROLE_WORDS]) {
            if (!new RegExp(`"${key}"`).test(line)) continue;
            // Sub-key exemption for opacity inside the fill declaration modules.
            if (
              key === "opacity" &&
              (OPACITY_SUBKEY_FILES as readonly string[]).includes(rel)
            ) {
              continue;
            }
            if (isDefinitionSite(line, key)) continue;
            if (isTypeAnnotationLiteral(line, key)) continue;
            hits.push(`${rel}:${lineNo}: bare "${key}"`);
          }
        }
      }
    }
    expect(hits, "bare declaration-key literals in read positions").toEqual([]);
  });
});
