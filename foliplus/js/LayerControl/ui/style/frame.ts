// Frame-level helpers for the style panel — pure DOM builders.
// No state, no events, no manager calls. The rail positioning math that used
// to live here moved into the slider primitive (common/slider.ts), which owns
// the track's coordinate space.
import { dom } from "#common/dom.js";
import type { LayerUI } from "../surface.js";

/** Reset footer — divider + button, same vocabulary for the annotation
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

export { appendResetFooter };
