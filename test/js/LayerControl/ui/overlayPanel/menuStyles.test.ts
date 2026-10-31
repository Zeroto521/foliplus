// The "more" menu items became native <button>s so the input layer can own
// Enter/Space. A button needs its native chrome reset — `background: none` and
// `color: inherit` — and that reset ties the shared item rule's specificity
// while landing later in the cascade (component bundle after the shared one),
// which silently killed the hover wash. These assertions pin the pair together:
// the reset owns the rest state, the component restates hover one class higher.
import { readFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(__dirname, "../../../../..");
const CSS_PATH = resolve(ROOT, "foliplus/css/LayerControl/menu.css");

const css = readFileSync(CSS_PATH, "utf8");

/** The declarations block that follows the first occurrence of `selector`. */
const blockOf = (selector: string): string => {
  const at = css.indexOf(selector);
  expect(at, `missing selector: ${selector}`).toBeGreaterThan(-1);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
};

describe("more-menu button styles", () => {
  it("resets the native button chrome at rest", () => {
    const rest = blockOf(".foliplus-layer-more-menu button {");
    expect(rest).toContain("background: none");
    expect(rest).toContain("color: inherit");
  });

  it("restates the shared hover wash above the reset", () => {
    const hover = blockOf(
      '.foliplus-layer-more-menu button:not([aria-disabled="true"]):hover {',
    );
    expect(hover).toContain("background: var(--foliplus-accent-light)");
    expect(hover).toContain("color: var(--foliplus-accent-primary)");
  });

  it("keeps disabled entries muted on hover", () => {
    // The restated hover is gated on aria-disabled, and the disabled rule wins
    // with its own background/color (transparent + muted) — a disabled entry
    // must never answer with the accent wash.
    const disabled = blockOf(
      '.foliplus-layer-more-menu button[aria-disabled="true"]:hover {',
    );
    expect(disabled).toContain("background: transparent");
    expect(disabled).toContain("color: var(--foliplus-text-muted)");
  });
});
