import { describe, expect, it } from "vitest";
import {
  LAYER_ORDER,
  TOKEN_MODULES,
  wrapCommonLayers,
  wrapComponentLayers,
} from "#script/css-layers.mjs";

describe("css-layers.mjs", () => {
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
    // No component rules in a common merge — that layer block is omitted.
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

  it("keeps component bodies intact inside the components layer", () => {
    const nested = ".a {\n  color: red;\n  .b { color: blue; }\n}";
    const body = wrapComponentLayers(nested);
    const open = body.indexOf("@layer foliplus.components {");
    const close = body.lastIndexOf("}");
    expect(open).toBeGreaterThan(-1);
    expect(body.slice(open, close)).toContain(".b { color: blue; }");
  });
});
