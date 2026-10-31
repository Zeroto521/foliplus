// The "more" menu items are native <button>s (task-12) so the input layer can
// own Enter/Space. A button needs its native chrome reset — `background: none`
// and `color: inherit` — but a plain reset ties the shared item rule's
// specificity and, being in the component bundle (loaded after the shared one),
// wins the cascade and silently kills the hover wash. The reset is therefore
// written inside `:where()` (specificity 0) so the shared hover/active rules
// always win; this contract pins that pair together.
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const cssDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../foliplus/css",
);
const read = (name: string): string => readFileSync(resolve(cssDir, name), "utf8");

const layerMenuCss = read("LayerControl/menu.css");
const sharedMenuCss = read("common/menu.css");

/** The declarations block that follows the first occurrence of `selector`. */
const blockOf = (css: string, selector: string): string => {
  const at = css.indexOf(selector);
  expect(at, `missing selector: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
};

describe("more-menu button styles", () => {
  it("resets the native button chrome through :where(), at zero specificity", () => {
    const rest = blockOf(layerMenuCss, ":where(.foliplus-layer-more-menu button) {");
    expect(rest).toContain("background: none");
    expect(rest).toContain("color: inherit");
  });

  it("keeps no plain-class reset that would beat the shared hover", () => {
    // The regression shape: a bare `.foliplus-layer-more-menu button {` block.
    // Its (0,2,1) reset outranks the shared hover and the items stop highlighting.
    expect(layerMenuCss).not.toMatch(/^\s*\.foliplus-layer-more-menu button \{/m);
  });

  it("lets the shared hover wash answer on the native buttons", () => {
    const hover = blockOf(
      sharedMenuCss,
      '.foliplus-layer-more-menu button:not([aria-disabled="true"]):hover {',
    );
    expect(hover).toContain("background: var(--foliplus-accent-light)");
    expect(hover).toContain("color: var(--foliplus-accent-primary)");
  });

  it("keeps disabled entries muted on hover", () => {
    const disabled = blockOf(
      layerMenuCss,
      '.foliplus-layer-more-menu button[aria-disabled="true"]:hover {',
    );
    expect(disabled).toContain("background: transparent");
    expect(disabled).toContain("color: var(--foliplus-text-muted)");
  });
});
