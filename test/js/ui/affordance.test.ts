import { describe, expect, it } from "vitest";
import { closeButton, panelButton, sectionDivider } from "#ui/affordance.js";

// ui/affordance builders are pure DOM structure. The class-name contract with
// the Python render-string tests is: a class passed to panelButton is joined
// onto the same class attribute as the shared foliplus-panel-btn, in the same
// order, so the rendered markup matches the long-standing reset/clear recipe.
describe("ui/affordance builders", () => {
  it("sectionDivider emits the shared hairline", () => {
    expect(sectionDivider().outerHTML).toBe('<hr class="foliplus-section-divider">');
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
