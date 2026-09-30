import { describe, expect, it } from "vitest";
import {
  LAYER_ORDER,
  TOKEN_MODULES,
  UNLAYERED_PATTERNS,
  hoistCompatOverrides,
  wrapCommonLayers,
  wrapComponentLayers,
} from "#script/css-layer.mjs";

describe("css-layer.mjs", () => {
  it("declares tokens < base < components on every artifact", () => {
    expect(LAYER_ORDER).toBe(
      "@layer foliplus.tokens, foliplus.base, foliplus.components;",
    );
  });

  it("maps only token.css into the tokens layer", () => {
    expect([...TOKEN_MODULES]).toEqual(["token.css"]);
  });

  it("wraps common: token.css first in tokens, everything else in base", () => {
    const bodies = {
      "token.css": ":root { --x: 1; }",
      "reset.css": ".reset { color: red; }",
      "button.css": ".btn { color: blue; }",
    };
    const body = wrapCommonLayers(
      ["token.css", "reset.css", "button.css"],
      file => bodies[file],
    );
    expect(body.startsWith(LAYER_ORDER)).toBe(true);
    const tokens = body.indexOf("@layer foliplus.tokens");
    const base = body.indexOf("@layer foliplus.base");
    const components = body.indexOf("@layer foliplus.components");
    expect(tokens).toBeGreaterThan(-1);
    expect(base).toBeGreaterThan(tokens);
    // No component rules in a common merge —that layer block is omitted.
    expect(components).toBe(-1);
    expect(body).toContain("--x: 1");
    expect(body).toContain(".reset { color: red; }");
    expect(body).toContain(".btn { color: blue; }");
    // Token body must sit inside the tokens block, before base content.
    const tokenBlock = body.slice(tokens, base);
    expect(tokenBlock).toContain("--x: 1");
    expect(tokenBlock).not.toContain(".reset");
  });

  it("omits empty layer blocks but always emits the order preamble", () => {
    const body = wrapComponentLayers(".search { color: red; }");
    expect(body.startsWith(LAYER_ORDER)).toBe(true);
    expect(body).toContain("@layer foliplus.components {");
    // Empty layers get no `{ … }` block — only the order preamble names them.
    expect(body).not.toContain("@layer foliplus.tokens {");
    expect(body).not.toContain("@layer foliplus.base {");
  });

  it("wrapCommonLayers skips the base layer when only tokens are present", () => {
    const body = wrapCommonLayers(["token.css"], () => ":root { --x: 1; }");
    expect(body).toContain("@layer foliplus.tokens {");
    expect(body).not.toContain("@layer foliplus.base {");
    expect(body).not.toContain("@layer foliplus.components {");
  });

  it("wrapCommonLayers skips the tokens layer when no token module is present", () => {
    const body = wrapCommonLayers(
      ["form.css", "button.css"],
      file => `.${file.replace(/\.css$/, "")} { color: red; }`,
    );
    expect(body).not.toContain("@layer foliplus.tokens {");
    expect(body).toContain("@layer foliplus.base {");
  });

  it("keeps component bodies intact inside the components layer", () => {
    const nested = ".a {\n  color: red;\n  .b { color: blue; }\n}";
    const body = wrapComponentLayers(nested);
    const open = body.indexOf("@layer foliplus.components {");
    const close = body.lastIndexOf("}");
    expect(open).toBeGreaterThan(-1);
    expect(body.slice(open, close)).toContain(".b { color: blue; }");
  });
});

describe("hoistCompatOverrides", () => {
  it("moves .leaflet-* rules out of @layer so they beat Leaflet library CSS", () => {
    const layered = wrapComponentLayers(
      [
        ".foliplus-search { color: red; }",
        ".leaflet-container.foliplus-no-base-map { background-image: repeating-conic-gradient(#000 0% 25%, #fff 0% 50%); }",
        ".leaflet-control.foliplus-scale-wrap { line-height: 14px; }",
      ].join("\n"),
    );
    const out = hoistCompatOverrides(layered);
    // Layer order preamble and non-hoisted chrome stay layered.
    expect(out.startsWith(LAYER_ORDER)).toBe(true);
    expect(out).toContain("@layer foliplus.components");
    // Leaflet-targeting rules are unlayered (no @layer wrapper).
    const hatch = out.indexOf(".leaflet-container.foliplus-no-base-map");
    const scale = out.indexOf(".leaflet-control.foliplus-scale-wrap");
    const layerEnd = out.lastIndexOf("@layer foliplus.components");
    expect(hatch).toBeGreaterThan(layerEnd);
    expect(scale).toBeGreaterThan(layerEnd);
    expect(out).not.toMatch(
      /@layer[^{]*\{[^}]*\.leaflet-container\.foliplus-no-base-map/,
    );
  });

  it("hoists dropdown/menu/row-panel shell rules so they beat host resets", () => {
    const layered = wrapComponentLayers(
      [
        ".foliplus-layer-ctrl .foliplus-layer-more-menu { padding: var(--foliplus-space-xs) 0; }",
        ":is(.foliplus-search-result-panel, .foliplus-heatmap-scheme-dropdown, .foliplus-layer-more-menu) { box-sizing: border-box; }",
        ".foliplus-panel.foliplus-row-panel { position: absolute; }",
        ".foliplus-layer-ctrl .foliplus-layer-item { display: flex; }",
        ".foliplus-heatmap-scheme-dropdown li { cursor: pointer; }",
      ].join("\n"),
    );
    const out = hoistCompatOverrides(layered);
    // Locate the components layer block by brace depth; hoisted rules land
    // after its closing brace, layered rules sit inside it.
    const open = out.indexOf("@layer foliplus.components {");
    let depth = 0;
    let close = -1;
    for (let i = open; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(open);
    for (const sel of [
      ".foliplus-layer-ctrl .foliplus-layer-more-menu {",
      ".foliplus-search-result-panel",
      ".foliplus-row-panel {",
    ]) {
      expect(out.indexOf(sel)).toBeGreaterThan(close);
    }
    // Non-shell component rules stay layered.
    const item = out.indexOf(".foliplus-layer-ctrl .foliplus-layer-item {");
    expect(item).toBeGreaterThan(-1);
    expect(item).toBeGreaterThan(open);
    expect(item).toBeLessThan(close);
    // A descendant selector that still names the shell class (…shell li) is
    // hoisted with its shell — the pattern matches the whole selector, and
    // item layout is part of the shell's anti-reset surface.
    const schemeLi = out.indexOf(".foliplus-heatmap-scheme-dropdown li {");
    expect(schemeLi).toBeGreaterThan(close);
  });

  it("is a no-op when no rule matches an unlayered pattern", () => {
    const layered = wrapComponentLayers(".foliplus-x { color: red; }");
    expect(hoistCompatOverrides(layered)).toBe(layered);
  });

  it("UNLAYERED_PATTERNS pins the two compat families", () => {
    expect(UNLAYERED_PATTERNS.map(re => re.source)).toContain("\\.leaflet");
    for (const cls of [
      ".foliplus-layer-more-menu",
      ".foliplus-search-result-panel",
      ".foliplus-heatmap-scheme-dropdown",
      ".foliplus-row-panel",
    ]) {
      expect(UNLAYERED_PATTERNS.some(re => re.test(cls))).toBe(true);
    }
  });
});
