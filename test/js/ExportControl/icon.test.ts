import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/ExportControl/icon.js";
import * as CommonIcons from "#common/icon.js";

describe("CAMERA", () => {
  it("is an SVG string", () => {
    expect(SVGs.CAMERA).toContain("<svg");
    expect(SVGs.CAMERA).toContain("</svg>");
    expect(SVGs.CAMERA).toContain("circle");
  });
});

describe("CHECK", () => {
  it("is an SVG string", () => {
    expect(SVGs.CHECK).toContain("<svg");
    expect(SVGs.CHECK).toContain("polyline");
  });
});

describe("DOWNLOAD_ICON", () => {
  it("is an SVG string", () => {
    expect(CommonIcons.DOWNLOAD_ICON).toContain("<svg");
    expect(CommonIcons.DOWNLOAD_ICON).toContain("path");
  });
});
