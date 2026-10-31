import { describe, expect, it, vi } from "vitest";
import {
  compressHtmlStrings,
  compressSvgStrings,
  transformSource,
} from "#script/build/compress.mjs";

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

  it("keeps both SVG literal forms when svgo throws", async () => {
    // A tree can contain SVG that SVGO refuses (an unsupported element or a
    // malformed fragment). The transform must leave the literal untouched
    // instead of failing the build — both the plain and the <div>-wrapped
    // forms, and independently of the HTML pass.
    vi.resetModules();
    vi.doMock("svgo", () => ({
      optimize: () => {
        throw new Error("svgo refused this fragment");
      },
    }));
    try {
      const mod = await import("#script/build/compress.mjs");
      const plain = `const svg = \`<svg><path d="M0 0 L1 1" /></svg>\`;`;
      expect(mod.compressSvgStrings(plain)).toBe(plain);
      const wrapped = `const svg = \`<div class="x"><svg><path d="M0 0" /></svg></div>\`;`;
      expect(mod.compressSvgStrings(wrapped)).toBe(wrapped);
      const html = `const html = \`<div>\n  <span>hi</span>\n</div>\`;`;
      expect(mod.compressHtmlStrings(html)).toContain("<div><span>hi</span></div>");
    } finally {
      vi.doUnmock("svgo");
      vi.resetModules();
    }
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

  it("keeps an unterminated template literal as-is", () => {
    const code = `const html = \`<div>unterminated`;
    expect(compressHtmlStrings(code)).toBe(code);
  });
});

describe("transformSource", () => {
  it("applies both SVG and HTML transforms", () => {
    const code = `const html = \`<div>\n<span>hi</span>\n</div>\`;`;
    const result = transformSource(code);
    expect(result).toContain("<div><span>hi</span></div>");
  });
});
