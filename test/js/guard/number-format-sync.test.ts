// test/js/guard/number-format-sync — the label number-format vocabulary twin guard.
//
// foliplus/_declaration/label.py owns NumberFormat, the one Python declaration
// of the four format words; NUMBER_FORMATS is derived from it and
// HeatmapControl.LABEL_FORMAT wraps the alias, so the generated NumberStyle
// union in foliplus/js/config-schema.ts is derived from the Python list rather
// than hand-copied. foliplus/js/platform/format.ts carries the runtime presets.
// LayerControl/_spec.py used to carry a second literal copy of the list. If any
// link widened, renamed or reordered a word and the others stayed, a format a
// declaration accepts would be rejected by the panel (or a runtime preset would
// name a format the generated union does not admit). This guard reads the
// Python declaration, the JS presets and the GENERATED schema file, pins all
// three to each other, and proves LayerControl's descriptor imports the list
// instead of copying it again.
//
// Tree guard, not a script module: registered under GUARD_TREE_SUBJECTS.
import {
  assertCrossLangLiteral,
  extractLiteral,
  readSource,
} from "./crossLangLiteral.js";
import { describe, expect, it } from "vitest";
import { NUMBER_FORMAT } from "#platform/format.js";

const PY_DECL = "foliplus/_declaration/label.py";
const PY_SPEC = "foliplus/control/LayerControl/_spec.py";
const JS_FORMAT = "foliplus/js/platform/format.ts";
const TS_SCHEMA = "foliplus/js/config-schema.ts";

/** Strip the quotes around a Python/TS string literal word. */
const bareWord = (word: string): string => word.trim().replace(/^["']|["']$/g, "");

/** The format words out of the Python NumberFormat Literal alias, in order.
 *  Single- and double-quoted literals alike: a quote-style change is not a
 *  vocabulary change. */
const pythonFormats = (): string[] =>
  extractLiteral(PY_DECL, /NumberFormat\s*=\s*Literal\[([^\]]+)\]/)
    .split(",")
    .map(bareWord)
    .filter(Boolean);

/** The format words out of the JS NUMBER_FORMAT preset object, in order. */
const jsFormats = (): string[] =>
  extractLiteral(JS_FORMAT, /const NUMBER_FORMAT = \{([^}]+)\} as const/)
    .split(",")
    .map(entry => entry.trim().match(/:\s*["']([^"']+)["']/)?.[1] ?? "")
    .filter(Boolean);

/** The format words out of the generated NumberStyle union alias, in order. */
const schemaFormats = (): string[] =>
  extractLiteral(TS_SCHEMA, /type NumberStyle = ([^;]+);/)
    .split("|")
    .map(bareWord)
    .filter(Boolean);

/** True when name is imported from module, whatever the import style: one
 *  line, parenthesised multi-line, reordered names, or aliased. Pinning one
 *  exact import statement would false-fail on a legal reformat. */
const importsName = (source: string, module: string, name: string): boolean => {
  const fromImport = new RegExp(
    `from\\s+${module.replace(/\./g, "\\.")}\\s+import\\s+(?:\\(([^)]*)\\)|([^\\n]*))`,
    "g",
  );
  return [...source.matchAll(fromImport)].some(match =>
    (match[1] ?? match[2] ?? "")
      // A one-line import may end in an inline comment (e.g. # noqa: F401).
      // A name never contains #, so dropping the comment before splitting the
      // list keeps the legal shape green.
      .split("#")[0]
      .split(",")
      .map(part =>
        part
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .includes(name),
  );
};

describe("label number-format vocabulary stays in step across the stack", () => {
  it("carries one identical format list in the Python declaration and the JS presets", () => {
    assertCrossLangLiteral(
      JSON.stringify(pythonFormats()),
      JSON.stringify(jsFormats()),
      "label number formats",
    );
  });

  it("derives the generated NumberStyle union from the Python list", () => {
    // config-schema.ts is generated from the Python schema dump, so this proves
    // the HeatmapControl alias reached the committed file.
    assertCrossLangLiteral(
      JSON.stringify(pythonFormats()),
      JSON.stringify(schemaFormats()),
      "generated NumberStyle",
    );
  });

  it("accepts an inline comment on a one-line import", () => {
    // A legal `from x import NAME  # noqa: F401` must not look like a missing
    // import: the comment is not part of the imported name list.
    const source = "from foliplus._declaration import NUMBER_FORMATS  # noqa: F401\n";
    expect(importsName(source, "foliplus._declaration", "NUMBER_FORMATS")).toBe(true);
  });

  it("keeps the vocabulary at the four formats the panels render", () => {
    expect(pythonFormats()).toEqual(["auto", "int", "comma", "percent"]);
  });

  it("exposes the same words at runtime as platform/format.ts declares", () => {
    expect(Object.values(NUMBER_FORMAT)).toEqual(pythonFormats());
  });

  it("imports the list into LayerControl's descriptor instead of copying it", () => {
    const specSource = readSource(PY_SPEC);
    expect(
      importsName(specSource, "foliplus._declaration", "NUMBER_FORMATS"),
      "LayerControl/_spec.py must import NUMBER_FORMATS from the declaration package",
    ).toBe(true);
    // A re-copied literal list is the drift this guard exists to stop; the
    // literal's quote style is the formatter's business, not the guard's.
    expect(specSource).not.toMatch(
      /["']auto["']\s*,\s*["']int["']\s*,\s*["']comma["']\s*,\s*["']percent["']/,
    );
    // And label.py owns the words once: the tuple is derived, not a second list.
    expect(readSource(PY_DECL)).toMatch(
      /NUMBER_FORMATS\s*(?::\s*[^=\n]+)?=\s*get_args\(\s*NumberFormat\s*\)/,
    );
  });
});
