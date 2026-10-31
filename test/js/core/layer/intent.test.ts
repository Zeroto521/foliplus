// Unit tests for core/layer/intent — the per-layer intent domain, focused
// on the value-based fill ramp's two arms (numeric / category).
import { describe, expect, it } from "vitest";
import { isFillRampConfig } from "#core/layer/intent.js";

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

describe("isFillRampConfig", () => {
  it("accepts a numeric record (kind numeric or absent)", () => {
    expect(isFillRampConfig(NUMERIC)).toBe(true);
    const { kind: _kind, ...absent } = NUMERIC;
    expect(isFillRampConfig(absent)).toBe(true);
  });

  it("accepts a category record without method or classes", () => {
    expect(isFillRampConfig(CATEGORY)).toBe(true);
  });

  it("accepts a category record that still carries method/classes", () => {
    // A migrated numeric record may retain the classifier fields; a category
    // does not classify, so they are tolerated but not required.
    expect(isFillRampConfig({ ...CATEGORY, method: "equal", classes: 3 })).toBe(true);
  });

  it("drops an unknown kind rather than misapplying it as numeric", () => {
    expect(isFillRampConfig({ ...NUMERIC, kind: "other" })).toBe(false);
    expect(isFillRampConfig({ ...CATEGORY, kind: "other" })).toBe(false);
  });

  it("drops a category record with a bad field or scheme", () => {
    expect(isFillRampConfig({ ...CATEGORY, field: "" })).toBe(false);
    expect(isFillRampConfig({ ...CATEGORY, scheme: "" })).toBe(false);
  });

  it("drops a category record with an invalid method or classes", () => {
    // A category's method/classes are optional; when present they must still
    // be well-formed (a category never classifies, but a record that claims a
    // bad method is malformed regardless of arm).
    expect(isFillRampConfig({ ...CATEGORY, method: "bad" })).toBe(false);
    expect(isFillRampConfig({ ...CATEGORY, classes: 1 })).toBe(false);
    expect(isFillRampConfig({ ...CATEGORY, classes: 10 })).toBe(false);
    expect(isFillRampConfig({ ...CATEGORY, classes: 3.5 })).toBe(false);
  });

  it("drops a numeric record missing any required field", () => {
    expect(isFillRampConfig({ field: "price", method: "equal", classes: 3 })).toBe(
      false,
    );
    expect(isFillRampConfig({ ...NUMERIC, classes: undefined })).toBe(false);
    expect(isFillRampConfig({ ...NUMERIC, method: undefined })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isFillRampConfig(null)).toBe(false);
    expect(isFillRampConfig("Reds")).toBe(false);
    expect(isFillRampConfig([1, 2, 3])).toBe(false);
  });
});
