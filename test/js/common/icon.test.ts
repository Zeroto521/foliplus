import { describe, expect, it } from "vitest";
import * as ICON from "#common/icon.js";

describe("", () => {
  it("is an SVG string", () => {
    expect(ICON.LOADING_ICON).toContain("<svg");
    expect(ICON.LOADING_ICON).toContain("foliplus-spin");
  });

  it("carries its own paint instead of inheriting from the host button", () => {
    // The arc is a closed path. Consumers that sit outside an
    // `svg { fill: none }` rule (the LocateControl and SearchControl popups)
    // get SVG's fill: black default, so without local paint the ring renders as
    // a solid pie slice with a notch. Presentation attributes keep this
    // working everywhere, and being lowest-priority CSS still lets a component
    // recolour the spinner.
    const path = ICON.LOADING_ICON.match(/<path[^>]*>/)?.[0] ?? "";
    expect(path).toContain('fill="none"');
    expect(path).toContain('stroke="currentColor"');
    expect(path).toContain("stroke-width=");
    expect(path).toContain("stroke-linecap=");
  });
});

describe("", () => {
  it("is an SVG string", () => {
    expect(ICON.CLOSE_ICON).toContain("<svg");
    expect(ICON.CLOSE_ICON).toContain("line");
  });
});

describe("PIN_ICON", () => {
  it("is an SVG string inside a div", () => {
    expect(ICON.PIN_ICON).toContain("foliplus-pin");
    expect(ICON.PIN_ICON).toContain("<svg");
  });
});

describe("", () => {
  it("is an SVG string", () => {
    expect(ICON.LOCATE_ICON).toContain("<svg");
    expect(ICON.LOCATE_ICON).toContain("path");
  });
});

describe("", () => {
  it("is an SVG string", () => {
    expect(ICON.GLOBE_ICON).toContain("<svg");
    expect(ICON.GLOBE_ICON).toContain("circle");
  });
});

describe("", () => {
  it("is an SVG string", () => {
    expect(ICON.EDIT_ICON).toContain("<svg");
    expect(ICON.EDIT_ICON).toContain("</svg>");
  });
});
