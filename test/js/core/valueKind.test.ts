// core/valueKind — vocabulary contract tests.
//
// These pin the by-value config kind vocabulary and the "absent is numeric"
// convention that every consumer relies on. A third kind, a rename, or a
// convention change that breaks any of these rows is a cross-consumer drift
// the unit tests of the migrated modules would not catch (they only see their
// own call sites).
import { describe, expect, it } from "vitest";
import { VALUE_KIND, isCategoryKind, isValueKind } from "#core/valueKind.js";

describe("VALUE_KIND vocabulary", () => {
  it("owns exactly the two by-value config kinds", () => {
    expect(VALUE_KIND).toEqual({ NUMERIC: "numeric", CATEGORY: "category" });
  });

  it("isValueKind accepts both kinds", () => {
    expect(isValueKind("numeric")).toBe(true);
    expect(isValueKind("category")).toBe(true);
  });

  it("isValueKind rejects everything else, including a third kind", () => {
    expect(isValueKind(undefined)).toBe(false);
    expect(isValueKind(null)).toBe(false);
    expect(isValueKind("")).toBe(false);
    expect(isValueKind("gradient")).toBe(false);
    expect(isValueKind("NUMERIC")).toBe(false);
    expect(isValueKind(42)).toBe(false);
    expect(isValueKind({})).toBe(false);
  });
});

describe("isCategoryKind (absent-is-numeric convention)", () => {
  it("is false for the numeric mode and for an absent kind", () => {
    expect(isCategoryKind(undefined)).toBe(false);
    expect(isCategoryKind("numeric")).toBe(false);
  });

  it("is true for the category mode", () => {
    expect(isCategoryKind("category")).toBe(true);
  });

  it("treats a kind outside the vocabulary as numeric (total, non-throwing)", () => {
    // The caller drops an invalid kind via isValueKind before this predicate
    // runs; the predicate itself must not throw on the leftover.
    expect(isCategoryKind("gradient" as never)).toBe(false);
  });
});
