// Unit tests for core/layer/intent — the per-layer intent domain, focused
// on the value-based fill ramp's two modes (numeric / category).
import { describe, expect, it } from "vitest";
import {
  FILL_MODE,
  INTENT,
  LIVE,
  isIconIntent,
  isValueConfig,
} from "#core/layer/index.js";

const NUMERIC = {
  kind: "numeric",
  field: "price",
  method: "quantile",
  classes: 6,
  scheme: "Reds",
};

const CATEGORY = {
  kind: "category",
  field: "kind",
  scheme: "Set3",
};

describe("isValueConfig", () => {
  it("accepts a numeric record (kind numeric or absent)", () => {
    expect(isValueConfig(NUMERIC)).toBe(true);
    const { kind: _kind, ...absent } = NUMERIC;
    expect(isValueConfig(absent)).toBe(true);
  });

  it("accepts a category record without method or classes", () => {
    expect(isValueConfig(CATEGORY)).toBe(true);
  });

  it("accepts a category record that still carries method/classes", () => {
    // A migrated numeric record may retain the classifier fields; a category
    // does not classify, so they are tolerated but not required.
    expect(isValueConfig({ ...CATEGORY, method: "equal", classes: 3 })).toBe(true);
  });

  it("drops an unknown kind rather than misapplying it as numeric", () => {
    expect(isValueConfig({ ...NUMERIC, kind: "other" })).toBe(false);
    expect(isValueConfig({ ...CATEGORY, kind: "other" })).toBe(false);
  });

  it("drops a category record with a bad field or scheme", () => {
    expect(isValueConfig({ ...CATEGORY, field: "" })).toBe(false);
    expect(isValueConfig({ ...CATEGORY, scheme: "" })).toBe(false);
  });

  it("drops a category record with an invalid method or classes", () => {
    // A category's method/classes are optional; when present they must still
    // be well-formed (a category never classifies, but a record that claims a
    // bad method is malformed regardless of mode).
    expect(isValueConfig({ ...CATEGORY, method: "bad" })).toBe(false);
    expect(isValueConfig({ ...CATEGORY, classes: 1 })).toBe(false);
    expect(isValueConfig({ ...CATEGORY, classes: 10 })).toBe(false);
    expect(isValueConfig({ ...CATEGORY, classes: 3.5 })).toBe(false);
  });

  it("drops a numeric record missing any required field", () => {
    expect(isValueConfig({ field: "price", method: "equal", classes: 3 })).toBe(false);
    expect(isValueConfig({ ...NUMERIC, classes: undefined })).toBe(false);
    expect(isValueConfig({ ...NUMERIC, method: undefined })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isValueConfig(null)).toBe(false);
    expect(isValueConfig("Reds")).toBe(false);
    expect(isValueConfig([1, 2, 3])).toBe(false);
  });
});

describe("isIconIntent", () => {
  it("accepts a glyph intent", () => {
    expect(isIconIntent({ kind: "glyph", value: "star" })).toBe(true);
  });

  it("rejects non-objects", () => {
    expect(isIconIntent(null)).toBe(false);
    expect(isIconIntent(undefined)).toBe(false);
    expect(isIconIntent("star")).toBe(false);
    expect(isIconIntent(["star"])).toBe(false);
  });

  it("rejects a wrong kind", () => {
    expect(isIconIntent({ kind: "ramp", value: "star" })).toBe(false);
    expect(isIconIntent({ kind: "size", value: 30 })).toBe(false);
    expect(isIconIntent({ value: "star" })).toBe(false);
  });

  it("rejects a non-string value", () => {
    expect(isIconIntent({ kind: "glyph", value: 42 })).toBe(false);
    expect(isIconIntent({ kind: "glyph", value: null })).toBe(false);
    expect(isIconIntent({ kind: "glyph" })).toBe(false);
  });
});

describe("LIVE border-mode value domain", () => {
  // The border mode is a closed value domain: solid / value / original. A
  // stored or in-flight literal outside it must fail the LIVE guard so the
  // row falls back to the author's border rather than advertising a broken
  // provenance marker (the persistence parser has the matching null drop).
  it("accepts only the three legal border-mode literals", () => {
    expect(LIVE[INTENT.BORDER_STYLE_MODE](FILL_MODE.SOLID)).toBe(true);
    expect(LIVE[INTENT.BORDER_STYLE_MODE](FILL_MODE.VALUE)).toBe(true);
    expect(LIVE[INTENT.BORDER_STYLE_MODE](FILL_MODE.ORIGINAL)).toBe(true);
  });

  it("rejects anything outside the border-mode domain", () => {
    expect(LIVE[INTENT.BORDER_STYLE_MODE]("ramp")).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE]("SOLID")).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE]("Original")).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE](undefined)).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE](null)).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE](123)).toBe(false);
    expect(LIVE[INTENT.BORDER_STYLE_MODE]({})).toBe(false);
  });

  it("does not let a rejected literal through the FILL_MODE guard either", () => {
    // Same closed domain for the fill mode — keep both in one place so the
    // value-domain invariant cannot drift between the two modes.
    expect(LIVE[INTENT.FILL_MODE]("ramp")).toBe(false);
    expect(LIVE[INTENT.FILL_MODE](FILL_MODE.ORIGINAL)).toBe(true);
  });
});
