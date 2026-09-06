import { describe, expect, it } from "vitest";
import * as ICON from "#common/icon.js";

describe("LOADING", () => {
  it("is an SVG string", () => {
    expect(ICON.LOADING).toContain("<svg");

    expect(ICON.LOADING).toContain("foliplus-spin");
  });
});

describe("CLOSE", () => {
  it("is an SVG string", () => {
    expect(ICON.CLOSE).toContain("<svg");

    expect(ICON.CLOSE).toContain("line");
  });
});

describe("PIN_ICON", () => {
  it("is an SVG string inside a div", () => {
    expect(ICON.PIN_ICON).toContain("foliplus-pin");

    expect(ICON.PIN_ICON).toContain("<svg");
  });
});

describe("LOCATE", () => {
  it("is an SVG string", () => {
    expect(ICON.LOCATE).toContain("<svg");

    expect(ICON.LOCATE).toContain("path");
  });
});

describe("GLOBE", () => {
  it("is an SVG string", () => {
    expect(ICON.GLOBE).toContain("<svg");

    expect(ICON.GLOBE).toContain("circle");
  });
});

describe("EDIT", () => {
  it("is an SVG string", () => {
    expect(ICON.EDIT).toContain("<svg");

    expect(ICON.EDIT).toContain("</svg>");
  });
});
