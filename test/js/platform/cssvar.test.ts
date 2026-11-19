import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cssVar } from "#platform/cssvar.js";

describe("cssVar", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    el.style.setProperty("--test-color", "red");
    document.body.append(el);
  });

  afterEach(() => {
    el.remove();
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
    document.body.append(empty);
    expect(cssVar(empty, "--empty", "default")).toBe("default");
    empty.remove();
  });

  it("returns empty string when no fallback is provided and property is missing", () => {
    expect(cssVar(el, "--missing")).toBe("");
  });
});
