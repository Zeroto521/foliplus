// Frame-level helpers for the style panel — pure DOM builders.
// No state, no events, no manager calls. The rail positioning math that used
// to live here moved into the slider primitive (LayerControl/slider.ts), which owns
// the track's coordinate space.
import { buttonRow, panelButton, sectionDivider } from "#ui/panelElements.js";
import type { LayerUI } from "../surface.js";

/** Reset footer — divider + button, same vocabulary for the annotation
 *  and the delegated panel. */
const appendResetFooter = (ui: LayerUI, content: HTMLElement): void => {
  content.append(
    sectionDivider(),
    buttonRow(
      panelButton({
        label: ui.T("style_reset"),
        className: "foliplus-style-reset-btn",
      }),
    ),
  );
};

export { appendResetFooter };
