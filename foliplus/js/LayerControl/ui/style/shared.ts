// Style-panel helpers shared by more than one style/*.ts module — pure DOM
// builders and math. No state, no events, no manager calls. Moved verbatim
// from ui/style.ts (34.1 §34.2.1).
import { dom } from "#common/dom.js";
import * as CONST from "../../const.js";
import type { LayerUI } from "../index.js";

/** Shared section heading (common/form.css `.foliplus-section-heading`).
 *  Used by labels.ts / delegated.ts / zoomRange.ts. */
const sectionHeading = (text: string): HTMLElement =>
  dom.el("div", { class: CONST.CLASSES.SECTION_HEADING }, text);

/** Shared Reset footer — divider + button, same vocabulary for the annotation
 *  and the delegated panel. */
const appendResetFooter = (ui: LayerUI, content: HTMLElement): void => {
  content.append(
    dom.el("hr", { class: "foliplus-section-divider" }),
    dom.el(
      "div",
      { class: "foliplus-btn-row" },
      dom.el(
        "button",
        {
          type: "button",
          class: "foliplus-panel-btn foliplus-style-reset-btn",
        },
        ui.T("style_reset"),
      ),
    ),
  );
};

/** Keep inline calc() strings short; the value is a position, not a secret.
 *  Used by opacity.ts (`opacityFillWidth`) and zoomRange.ts (`railPos`). */
const round5 = (n: number): number => Math.round(n * 1e5) / 1e5;

/** Where a percentage along a slider rail lands. Every mark on the rail —
 *  fill ends, the current-level dot and the numbers under them — goes
 *  through this one mapping, and it is the rail's own percentage: the
 *  stylesheet insets the rail by half a handle and lets the inputs reach
 *  that far beyond it, so a handle's centre *is* its percentage of the
 *  rail, and every mark that shares the mapping lands on it.
 *
 *  Used by both the opacity row (via `opacityFillWidth`) and the
 *  zoom-range row (via `railPos`). */
const railPos = (pct: number): string => `${round5(pct)}%`;

export { appendResetFooter, railPos, round5, sectionHeading };
