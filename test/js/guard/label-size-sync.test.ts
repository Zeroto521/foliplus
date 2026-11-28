// test/js/guard/label-size-sync — the label font-size bounds twin guard.
//
// foliplus/_declaration/label.py (LABEL_SIZE_MIN / LABEL_SIZE_MAX) and
// foliplus/js/ui/form.ts (LABEL_SIZE.SIZE_MIN / SIZE_MAX) each carry the same
// two numbers by hand: Python clamps a declared foliplus={"label": {"size": …}}
// value into them, JS clamps the style-drawer/heatmap number input and the
// saved record. If one side widened a bound and the other stayed, the same
// declared size would be valid in one channel and clamped (or rejected) in the
// other — the cross-stack drift the format guard already pins for the
// vocabulary. This guard reads both numbers from both sources and compares
// them, so a one-sided edit or a two-sided edit that still disagrees fails.
//
// Tree guard, not a script module: registered under GUARD_TREE_SUBJECTS.
import { assertCrossLangLiteral, extractLiteral } from "./crossLangLiteral.js";
import { describe, expect, it } from "vitest";
import { LABEL_SIZE } from "#ui/index.js";

const PY_DECL = "foliplus/_declaration/label.py";
const JS_FORM = "foliplus/js/ui/form.ts";

/** LABEL_SIZE_MIN / LABEL_SIZE_MAX out of the Python declaration, as text. */
const pyBound = (name: "LABEL_SIZE_MIN" | "LABEL_SIZE_MAX"): string =>
  extractLiteral(
    PY_DECL,
    new RegExp(`${name}\\s*(?::\\s*[A-Za-z]\\w*)?\\s*=\\s*(\\d+)`),
  );

/** SIZE_MIN / SIZE_MAX out of the JS LABEL_SIZE record, as text. */
const jsBound = (name: "SIZE_MIN" | "SIZE_MAX"): string =>
  extractLiteral(JS_FORM, new RegExp(`${name}:\\s*(\\d+)`));

describe("label font-size bounds stay in step across Python and JS", () => {
  it("carries the same min and max on both sides", () => {
    assertCrossLangLiteral(
      pyBound("LABEL_SIZE_MIN"),
      jsBound("SIZE_MIN"),
      "LABEL_SIZE_MIN vs SIZE_MIN",
    );
    assertCrossLangLiteral(
      pyBound("LABEL_SIZE_MAX"),
      jsBound("SIZE_MAX"),
      "LABEL_SIZE_MAX vs SIZE_MAX",
    );
  });

  it("keeps the shared bounds at the values both channels enforce", () => {
    // A deliberate widening is a real contract change: both sources and this
    // guard move together, so a stale one-sided edit cannot ship.
    expect([pyBound("LABEL_SIZE_MIN"), pyBound("LABEL_SIZE_MAX")]).toEqual(["6", "32"]);
  });

  it("exposes the same bounds at runtime as form.ts declares", () => {
    expect(String(LABEL_SIZE.SIZE_MIN)).toBe(pyBound("LABEL_SIZE_MIN"));
    expect(String(LABEL_SIZE.SIZE_MAX)).toBe(pyBound("LABEL_SIZE_MAX"));
  });
});
