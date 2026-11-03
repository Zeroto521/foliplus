import { describe, expect, it } from "vitest";
import {
  buttonRow,
  closeButton,
  panelButton,
  sectionDivider,
} from "#ui/panelElements.js";

// ui/panelElements builders are pure DOM structure. The class-name contract with
// the Python render-string tests is: a class passed to panelButton is joined
// onto the same class attribute as the shared foliplus-panel-btn, in the same
// order, so the rendered markup matches the long-standing reset/clear recipe.
describe("ui/panelElements builders", () => {
  it("sectionDivider emits the shared hairline", () => {
    expect(sectionDivider().outerHTML).toBe('<hr class="foliplus-section-divider">');
  });

  it("buttonRow wraps children in the shared btn-row", () => {
    const btn = panelButton({ label: "Reset" });
    const row = buttonRow(btn);
    expect(row.tagName).toBe("DIV");
    expect(row.classList.contains("foliplus-btn-row")).toBe(true);
    expect(row.children).toHaveLength(1);
    expect(row.children[0]).toBe(btn);
  });

  it("sectionDivider accepts div for callers whose layout needs a block", () => {
    // list.ts's toggle-all row is a CSS grid cell: an <hr> would inherit the
    // UA margin (0.5em auto) and shift the row; the caller passes "div" to
    // keep the pre-S1 block element.
    const div = sectionDivider("div");
    expect(div.tagName).toBe("DIV");
    expect(div.classList.contains("foliplus-section-divider")).toBe(true);
    expect(div.outerHTML).toBe('<div class="foliplus-section-divider"></div>');
  });

  it("panelButton joins the shared panel-btn class with the caller class", () => {
    const btn = panelButton({ label: "Reset", className: "foliplus-style-reset-btn" });
    expect(btn.type).toBe("button");
    expect(btn.classList.contains("foliplus-panel-btn")).toBe(true);
    expect(btn.classList.contains("foliplus-style-reset-btn")).toBe(true);
    // The rendered class attribute must be the exact long-standing recipe.
    expect(btn.outerHTML).toBe(
      '<button type="button" class="foliplus-panel-btn foliplus-style-reset-btn" aria-label="Reset">Reset</button>',
    );
  });

  it("closeButton carries the close-btn class and the title as aria-label", () => {
    const btn = closeButton({ title: "Clear", iconSvg: "<svg/>" });
    expect(btn.type).toBe("button");
    expect(btn.classList.contains("foliplus-close-btn")).toBe(true);
    expect(btn.getAttribute("aria-label")).toBe("Clear");
  });
});
