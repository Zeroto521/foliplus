import { describe, expect, it } from "vitest";
import * as ICON from "#common/icon.js";

describe("ICON_LOADING", () => {
  it("is an SVG string", () => {
    expect(ICON.ICON_LOADING).toContain("<svg");
    expect(ICON.ICON_LOADING).toContain("foliplus-spin");
  });

  it("carries its own paint instead of inheriting from the host button", () => {
    // The arc is a closed path. Consumers that sit outside an
    // `svg { fill: none }` rule (the LocateControl and SearchControl popups)
    // get SVG's fill: black default, so without local paint the ring renders as
    // a solid pie slice with a notch. Presentation attributes keep this
    // working everywhere, and being lowest-priority CSS still lets a component
    // recolor the spinner.
    const path = ICON.ICON_LOADING.match(/<path[^>]*>/)?.[0] ?? "";
    expect(path).toContain('fill="none"');
    expect(path).toContain('stroke="currentColor"');
    expect(path).toContain("stroke-width=");
    expect(path).toContain("stroke-linecap=");
  });
});

describe("ICON_CLOSE", () => {
  it("is an SVG string", () => {
    expect(ICON.ICON_CLOSE).toContain("<svg");
    expect(ICON.ICON_CLOSE).toContain("line");
  });
});

describe("ICON_PIN", () => {
  it("is an SVG string inside a div", () => {
    expect(ICON.ICON_PIN).toContain("foliplus-pin");
    expect(ICON.ICON_PIN).toContain("<svg");
  });
});

describe("ICON_LOCATION_PIN", () => {
  it("is an SVG string", () => {
    expect(ICON.ICON_LOCATION_PIN).toContain("<svg");
    expect(ICON.ICON_LOCATION_PIN).toContain("path");
  });
});

describe("ICON_GLOBE", () => {
  it("is an SVG string", () => {
    expect(ICON.ICON_GLOBE).toContain("<svg");
    expect(ICON.ICON_GLOBE).toContain("circle");
  });
});

describe("ICON_EDIT", () => {
  it("is an SVG string", () => {
    expect(ICON.ICON_EDIT).toContain("<svg");
    expect(ICON.ICON_EDIT).toContain("</svg>");
  });
});
