import { describe, expect, it } from "vitest";
import * as SVGs from "#foliplus/ExportControl/icon.js";
import * as CommonIcons from "#common/icon.js";

describe("CAMERA", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_CAMERA).toContain("<svg");
    expect(SVGs.ICON_CAMERA).toContain("</svg>");
    expect(SVGs.ICON_CAMERA).toContain("circle");
  });
});

describe("CHECK", () => {
  it("is an SVG string", () => {
    expect(SVGs.ICON_CHECK).toContain("<svg");
    expect(SVGs.ICON_CHECK).toContain("polyline");
  });
});

describe("ICON_DOWNLOAD", () => {
  it("is an SVG string", () => {
    expect(CommonIcons.ICON_DOWNLOAD).toContain("<svg");
    expect(CommonIcons.ICON_DOWNLOAD).toContain("path");
  });
});
