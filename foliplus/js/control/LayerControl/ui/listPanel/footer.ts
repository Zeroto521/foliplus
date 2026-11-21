// ui/listPanel/footer — the panel footer for the layer list.
//
// The footer carries the "restore author layout" action: the user-facing
// counterpart of the folder-layout reset. It sits below the layer rows,
// separated by the shared section divider, and uses the same button
// vocabulary as the style/filter panel footers (panelButton + buttonRow),
// so it cannot drift from the Reset / Clear affordances.
//
// The button is disabled while the live layout already equals the author
// declaration (isAuthorLayout) — the user has nothing to undo. It is enabled
// once any folder operation (create / move / rename / delete / clean) has
// diverged the layout from the seed.
//
// The footer is rebuilt with the list (renderInitialList appends it after the
// rows), so the disabled state is re-evaluated on every rebuild.
//
// This is a pure DOM builder: the click is dispatched by the panel's delegated
// container listener (lifecycle.ts ui.onClick), the same pattern as the
// clean-empty-folders button — the footer is a panel-level action, not a
// per-row one, and the action rerenders the list it sits in.
import type { LayerUI } from "../surface.js";
import { buttonRow, panelButton, sectionDivider } from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";

/** Build the panel footer with the restore-author-layout button.
 *
 *  @param ui - The LayerUI shell (reads the controller through ui.c).
 *  @returns The footer element (divider + button row).
 */
const buildFooter = (ui: LayerUI): HTMLElement => {
  const button = panelButton({
    label: ui.T("restore_author_layout"),
    className: CONST.CLASSES.RESTORE_AUTHOR_LAYOUT_BTN,
  });
  button.title = ui.T("restore_author_layout_tooltip");
  // Disabled when the live layout already matches the author declaration.
  if (ui.c.isAuthorLayout()) {
    button.disabled = true;
    button.title = ui.T("restore_author_layout_disabled");
  }
  return buttonRow(sectionDivider("div"), button);
};

export { buildFooter };
