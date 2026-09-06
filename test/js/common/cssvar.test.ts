import { beforeEach, describe, expect, it, vi } from "vitest";
import { cssVar } from "#common/cssvar.js";

describe("cssVar", () => {
  let el;

  beforeEach(() => {
    el = document.createElement("div");

    el.style.setProperty("--test-color", "red");
  });

  it("reads a CSS custom property", () => {
    expect(cssVar(el, "--test-color")).toBe("red");
  });

  it("returns fallback when property is not set", () => {
    expect(cssVar(el, "--nonexistent", "blue")).toBe("blue");
  });

  it("returns fallback when property is empty", () => {
    const empty = document.createElement("div");

    empty.style.setProperty("--empty", "  ");

    expect(cssVar(empty, "--empty", "default")).toBe("default");
  });

  it("returns empty string when no fallback is provided and property is missing", () => {
    expect(cssVar(el, "--missing")).toBe("");
  });
});
