// script/check/role-words-sync — the layer-role vocabulary twin guard.
//
// foliplus/control/LayerControl/_role.py and foliplus/js/core/layer/const.ts
// each carry the two role words as a hand-written literal. The JS ROLE object
// stamps LayerRole and the whole panel reads it, and the Python Literal feeds
// the central folders config; if one side renamed or added a word and the other
// stayed, a role the author declares through Python would not match the role the
// panel paints through JS. This guard pins the two word SETS to each other.
//
// Tree guard, not a script module: registered under NON_MODULE_TEST_SUBJECTS
// as check/role-words-sync.
import { assertCrossLangLiteral, extractLiteral } from "./crossLangLiteral.js";
import { describe, expect, it } from "vitest";

const PY_ROLE = "foliplus/control/LayerControl/_role.py";
const JS_ROLE = "foliplus/js/core/layer/const.ts";

/** Pull the role words out of the Python Literal declaration, in order. */
const pyRoleWords = (): string[] =>
  extractLiteral(
    PY_ROLE,
    /LayerRole = Literal\[(["'][^"']+["'](?:\s*,\s*["'][^"']+["'])*)\]/,
  )
    .split(",")
    .map(word => word.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/** Pull the role words out of the JS ROLE object, in declaration order. */
const jsRoleWords = (): string[] =>
  extractLiteral(JS_ROLE, /const ROLE = {([^}]+)} as const;/)
    .split(",")
    .map(entry => entry.trim().match(/:\s*["']([^"']+)["']/)?.[1] ?? "")
    .filter(Boolean);

describe("layer-role vocabulary stays in step across Python and JS", () => {
  it("carries the same role words on both sides, as the same set", () => {
    const pyWords = pyRoleWords();
    const jsWords = jsRoleWords();
    // Same vocabulary as a set: the two declarations are unordered maps
    // (Python Literal order and JS object key order are independent), so the
    // guard compares sorted words — a missing or extra word still fails.
    assertCrossLangLiteral(
      JSON.stringify([...pyWords].sort()),
      JSON.stringify([...jsWords].sort()),
      "role words",
    );
    // And the vocabulary is exactly the two roles — a third word on one side
    // is a real vocabulary change that must be mirrored, not silently added.
    expect(pyWords).toEqual(["base", "overlay"]);
  });
});
