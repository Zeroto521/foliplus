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

/** The format words out of the Python NumberFormat Literal alias, in order. */
const pythonFormats = (): string[] =>
  extractLiteral(PY_DECL, /NumberFormat = Literal\[([^\]]+)\]/)
    .split(",")
    .map(word => word.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

/** The format words out of the JS NUMBER_FORMAT preset object, in order. */
const jsFormats = (): string[] =>
  extractLiteral(JS_FORMAT, /const NUMBER_FORMAT = \{([^}]+)\} as const/)
    .split(",")
    .map(entry => entry.trim().match(/:\s*"([^"]+)"/)?.[1] ?? "")
    .filter(Boolean);

/** The format words out of the generated NumberStyle union alias, in order. */
const schemaFormats = (): string[] =>
  extractLiteral(TS_SCHEMA, /type NumberStyle = ([^;]+);/)
    .split("|")
    .map(word => word.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

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

  it("keeps the vocabulary at the four formats the panels render", () => {
    expect(pythonFormats()).toEqual(["auto", "int", "comma", "percent"]);
  });

  it("exposes the same words at runtime as platform/format.ts declares", () => {
    expect(Object.values(NUMBER_FORMAT)).toEqual(pythonFormats());
  });

  it("imports the list into LayerControl's descriptor instead of copying it", () => {
    const specSource = readSource(PY_SPEC);
    expect(specSource).toContain("from foliplus._declaration import NUMBER_FORMATS");
    // A re-copied literal list is the drift this guard exists to stop.
    expect(specSource).not.toMatch(/"auto"\s*,\s*"int"\s*,\s*"comma"\s*,\s*"percent"/);
    // And label.py owns the words once: the tuple is derived, not a second list.
    expect(readSource(PY_DECL)).toContain(
      "NUMBER_FORMATS: tuple[str, ...] = get_args(NumberFormat)",
    );
  });
});
