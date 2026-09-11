// Tests for common/sanitize — the SVG allowlist gate feeding every icon sink.
//
// Dimension under test: presentation SVG survives; anything executable does not.
//
// Mounting note: parsing the cleaned output with `text/html` moves SVG markup
// into the HTML namespace, which is exactly what the downstream sinks (an
// innerHTML assignment) do. Tests that only assert on the serialised output
// are namespace-agnostic.
import { describe, expect, it } from "vitest";

const mod = await import("#common/sanitize.js");
const { parseSVG, safeSVG } = mod;

/** Re-parse through the same `innerHTML` sink the real callers use. */
const mount = (html: string): Element => {
  const host = document.createElement("div");
  host.innerHTML = html;
  return host;
};

/** Every element in `html` that carries an attribute with `name` (matched
 *  case-insensitively). */
const withAttr = (html: string, name: string): Element[] => {
  const host = mount(html);
  return [...host.querySelectorAll("*")].filter(el =>
    [...el.attributes].some(a => a.name.toLowerCase() === name),
  );
};

describe("parseSVG — accepts presentation SVG", () => {
  it("keeps a rect icon with viewBox and fill", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" width="16" height="16">' +
        '<rect x="1" y="1" width="14" height="14" rx="2"/></svg>',
    );
    const host = mount(out);
    const svg = host.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.querySelector("rect")!.getAttribute("rx")).toBe("2");
    expect(svg.hasAttribute("stroke")).toBe(true);
  });

  it("keeps a <style> block holding CSS rules, including var()", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><style>.a{fill:var(--icon-color)}</style>' +
        '<circle class="a" cx="5" cy="5" r="4"/></svg>',
    );
    const host = mount(out);
    expect(host.querySelector("style")).not.toBeNull();
    expect(host.querySelector("style")!.textContent).toContain("var(--icon-color)");
  });

  it("keeps a stroke-dasharray + linecap marker", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 12 12"><line x1="1" y1="11" x2="11" y2="1" ' +
        'stroke-width="2" stroke-linecap="round" stroke-dasharray="3 2"/></svg>',
    );
    const line = mount(out).querySelector("line")!;
    expect(line.getAttribute("stroke-dasharray")).toBe("3 2");
    expect(line.getAttribute("stroke-linecap")).toBe("round");
  });

  it("keeps a gradient + path icon (the repository's typical icon shape)", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 20 20" width="20" height="20"><defs>' +
        '<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
        '<path d="M2 18 L10 2 L18 18 Z" fill="url(#g)" stroke="#000" stroke-width="1"/></svg>',
    );
    const host = mount(out);
    expect(host.querySelector("path")!.getAttribute("d")).toBe("M2 18 L10 2 L18 18 Z");
    expect(host.querySelector("linearGradient")).not.toBeNull();
  });
});

describe("parseSVG — strips executable content", () => {
  it("drops the whole fragment when there is no SVG at all", () => {
    expect(parseSVG("<img src=x onerror=alert(1)>")).toBe("");
    expect(parseSVG("<script>alert(1)</script>")).toBe("");
    expect(parseSVG("plain text")).toBe("");
  });

  it("drops a <script> nested inside an SVG", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><rect width="4" height="4"/></svg>',
    );
    const host = mount(out);
    expect(host.querySelector("script")).toBeNull();
    expect(host.querySelector("rect")).not.toBeNull();
  });

  it("drops on* event-handler attributes", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><rect onmouseover="alert(1)" onclick="x" ' +
        'width="4" height="4" fill="#000"/></svg>',
    );
    const rect = mount(out).querySelector("rect")!;
    expect(rect.hasAttribute("onmouseover")).toBe(false);
    expect(rect.hasAttribute("onclick")).toBe(false);
    expect(rect.getAttribute("fill")).toBe("#000");
  });

  it("rejects a namespace declaration carrying a scheme", () => {
    // `xmlns` is structural and always kept, so a hostile value there must not
    // get through either. Match by attribute name rather than `hasAttribute` —
    // that only sees the element's own default namespace.
    const out = parseSVG(
      '<svg viewBox="0 0 4 4" xmlns="http://x"><rect width="2" height="2" xmlns:xlink="javascript:alert(1)"/></svg>',
    );
    expect(out).toContain("http://x");
    expect(withAttr(out, "xmlns:xlink")).toHaveLength(0);
  });

  it("keeps a namespace declaration the serializer needs to round-trip SVG", () => {
    // Dropping `xmlns` was the latent defect in this gate: Chromium's `outerHTML`
    // re-declares the SVG namespace on every element when the declaration is
    // missing, which turns a `class` into an SVG-namespace attr no CSS selector
    // can match. There is no security payoff to dropping it, so keep it and pin
    // the round trip here — jsdom serialises both shapes identically, so only a
    // real browser can see this, and only the declaration count in the output
    // string is observable (not `hasAttribute`, which sees just the element's own
    // default namespace).
    const src =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4">' +
      '<g xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></g></svg>';
    const out = parseSVG(src);
    expect(out).toContain("http://www.w3.org/2000/svg");
    // The parser normalises both declarations to the element's default
    // namespace, so an explicit one becomes inert and is dropped. Only the
    // root's survives — the serialiser's single point of truth.
    expect(withAttr(out, "xmlns")).toHaveLength(1);
    expect(out.match(/xmlns/g)).toHaveLength(1);
  });

  it("drops a style block that is not pure CSS rules", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><style>/* not a rule */</style>' +
        '<rect width="4" height="4"/></svg>',
    );
    expect(mount(out).querySelector("style")).toBeNull();
  });

  it("drops <foreignObject> and any nested HTML content", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10">' +
        "<foreignObject><div>x</div></foreignObject>" +
        '<rect width="4" height="4"/></svg>',
    );
    const host = mount(out);
    expect(host.querySelector("foreignobject")).toBeNull();
    expect(host.querySelector("rect")).not.toBeNull();
  });

  it("drops <use> — its href is an external fetch / paint-server channel", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 8 8"><use href="#dot"/><rect width="3" height="3"/></svg>',
    );
    const host = mount(out);
    expect(host.querySelector("use")).toBeNull();
    expect(host.querySelector("rect")).not.toBeNull();
  });

  it("refuses a document with more than one root — that is not an icon", () => {
    // A second root is not "extra markup" the parser tolerates: `image/svg+xml`
    // is well-formed-only, so jsdom returns a `<parsererror>` document and the
    // whole fragment is unusable. Return "" rather than emit that error node.
    const out = parseSVG(
      '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>' +
        '<img src=x onerror=alert(1)><svg viewBox="0 0 2 2"><rect width="2" height="2"/></svg>',
    );
    expect(out).toBe("");
  });
});

describe("parseSVG — drops non-presentation attributes", () => {
  it("drops attribute names outside the allowlist", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10" class="icon" id="leak" data-x="1">' +
        '<rect width="4" height="4" class="hit"/></svg>',
    );
    const host = mount(out);
    const root = host.querySelector("svg")!;
    expect(root.getAttribute("class")).toBe("icon");
    expect(root.hasAttribute("id")).toBe(false);
    expect(root.hasAttribute("data-x")).toBe(false);
    expect(host.querySelector("rect")!.getAttribute("class")).toBe("hit");
  });

  it("drops a URL-valued presentation attribute (external paint server)", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><rect width="4" height="4" fill="url(http://x)"/></svg>',
    );
    expect(mount(out).querySelector("rect")!.hasAttribute("fill")).toBe(false);
  });

  it("keeps local gradient references (url(#id), not a fetch)", () => {
    const out = parseSVG(
      '<svg viewBox="0 0 10 10"><defs><linearGradient id="g">' +
        '<stop offset="0" stop-color="#fff"/></linearGradient></defs>' +
        '<rect width="4" height="4" fill="url(#g)"/></svg>',
    );
    expect(mount(out).querySelector("rect")!.getAttribute("fill")).toBe("url(#g)");
  });

  it("keeps every non-URL value that merely contains a colon", () => {
    // CSS keyword, currentColor, hex, var(), and unprefixed local refs all
    // contain `:` and are not URLs. Dropping them would blank the icon set.
    const out = parseSVG(
      '<svg viewBox="0 0 10 10">' +
        '<rect width="4" height="4" fill="none" stroke="currentColor" ' +
        'opacity="0.8" style="fill:#fff;color:red" fill-opacity="1" />' +
        '<text x="0" y="10" font-size="10" fill="var(--c)">t</text>' +
        "</svg>",
    );
    const host = mount(out);
    const rect = host.querySelector("rect")!;
    expect(rect.getAttribute("fill")).toBe("none");
    expect(rect.getAttribute("stroke")).toBe("currentColor");
    expect(rect.getAttribute("opacity")).toBe("0.8");
    expect(rect.getAttribute("fill-opacity")).toBe("1");
    expect(host.querySelector("text")!.getAttribute("fill")).toBe("var(--c)");
  });

  it("drops protocol-relative and data: refs in url()", () => {
    for (const val of [
      'fill="url(//evil/evil.svg#f)"',
      'fill="url(data:image/svg+xml;base64,AAAA)"',
    ]) {
      const out = parseSVG(
        `<svg viewBox="0 0 4 4"><rect width="2" height="2" ${val}/></svg>`,
      );
      expect(mount(out).querySelector("rect")!.hasAttribute("fill")).toBe(false);
    }
  });
});

describe("safeSVG", () => {
  it("returns the fallback when the input holds no SVG", () => {
    expect(safeSVG(null)).toBe("");
    expect(safeSVG("")).toBe("");
    expect(safeSVG("<img src=x>", "FALLBACK")).toBe("FALLBACK");
  });

  it("returns the cleaned SVG when the input is usable", () => {
    const out = safeSVG('<svg viewBox="0 0 4 4"><rect width="2" height="2"/></svg>');
    expect(out).toContain("viewBox");
    expect(out).toContain("rect");
  });

  it("returns the fallback for empty or degenerate SVG", () => {
    expect(safeSVG("<svg></svg>")).toBe("");
    expect(safeSVG("<svg/>", "FB")).toBe("FB");
  });
});
