import { describe, expect, it } from "vitest";
import {
  compressHtmlStrings,
  compressSvgStrings,
  transformSource,
} from "#script/compress.mjs";

describe("compressSvgStrings", () => {
  it("compresses inline SVG template literal", () => {
    const code = `const svg = \`<svg><path d="M0 0 L1 1" /></svg>\`;`;
    const result = compressSvgStrings(code);

    expect(result).toContain("<svg");

    expect(result).toContain("path");
  });

  it("handles SVG inside div wrapper", () => {
    const code = `const svg = \`<div class="x"><svg><path d="M0 0" /></svg></div>\`;`;
    const result = compressSvgStrings(code);

    expect(result).toContain("<div");

    expect(result).toContain("<svg");
  });

  it("preserves non-SVG template literals", () => {
    const code = `const x = \`hello world\`;`;
    const result = compressSvgStrings(code);

    expect(result).toBe(code);
  });
});

describe("compressHtmlStrings", () => {
  it("collapses multiline whitespace", () => {
    const code = `const html = \`<div>\n  <span>hello</span>\n</div>\`;`;
    const result = compressHtmlStrings(code);

    expect(result).toContain("<div><span>hello</span></div>");
  });

  it("collapses > < to ><", () => {
    const code = `const html = \`<div> <span>hi</span> </div>\`;`;
    const result = compressHtmlStrings(code);

    expect(result).toContain("<div><span>hi</span></div>");
  });

  it("handles nested template literals", () => {
    const code = `const html = \`<div>\${name} <span>hi</span></div>\`;`;
    const result = compressHtmlStrings(code);

    expect(result).toContain("name");

    expect(result).toContain("hi");
  });

  it("collapses consecutive spaces", () => {
    const code = `const html = \`<div>hello    world</div>\`;`;
    const result = compressHtmlStrings(code);

    expect(result).toContain("<div>hello world</div>");
  });

  it("preserves non-HTML template literals", () => {
    const code = `const x = \`hello world with no tags\`;`;
    const result = compressHtmlStrings(code);

    expect(result).toBe(code);
  });
});

describe("transformSource", () => {
  it("applies both SVG and HTML transforms", () => {
    const code = `const html = \`<div>\n<span>hi</span>\n</div>\`;`;
    const result = transformSource(code);

    expect(result).toContain("<div><span>hi</span></div>");
  });
});
