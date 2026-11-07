import { describe, expect, it } from "vitest";
import { appendResetFooter } from "#control/LayerControl/ui/style/frame.js";
import type { LayerUI } from "#control/LayerControl/ui/surface.js";

const makeUI = (label = "Reset"): LayerUI =>
  ({ T: (key: string) => (key === "style_reset" ? label : key) }) as unknown as LayerUI;

describe("appendResetFooter", () => {
  it("appends a section divider then a reset button row", () => {
    const content = document.createElement("div");
    appendResetFooter(makeUI(), content);
    const divider = content.querySelector(".foliplus-section-divider");
    const row = content.querySelector(".foliplus-btn-row");
    const btn = row?.querySelector("button.foliplus-style-reset-btn");
    expect(divider).not.toBeNull();
    expect(row).not.toBeNull();
    expect(btn).not.toBeNull();
  });

  it("labels the reset button from ui.T and marks it a plain button", () => {
    const content = document.createElement("div");
    appendResetFooter(makeUI("Reset styles"), content);
    const btn = content.querySelector(
      "button.foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe("Reset styles");
    expect(btn.getAttribute("aria-label")).toBe("Reset styles");
    expect(btn.type).toBe("button");
  });

  it("uses the shared panel button vocabulary", () => {
    const content = document.createElement("div");
    appendResetFooter(makeUI(), content);
    const btn = content.querySelector(
      "button.foliplus-style-reset-btn",
    ) as HTMLButtonElement;
    expect(btn.classList.contains("foliplus-panel-btn")).toBe(true);
  });
});
