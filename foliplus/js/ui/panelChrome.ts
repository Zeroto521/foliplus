// ui/panelChrome — panel chrome builders.
//
// Pure DOM structure for the small chrome that used to be hand-assembled at
// each call site: the section divider, the button row, a panel button, and
// the header close button. No state, no events, no manager — these are just
// the markup, so the panel-shell behavior layer (core/leaflet/panel.ts)
// owns open/close/outside-press and these builders stay inert.
//
// The class names come from ui/panelClassName.ts (the single source), so the
// vocabulary cannot drift between the style panel, the filter panel and the
// heatmap template.
import { PANEL_CLASS } from "./panelClassName.js";
import { dom } from "#platform/dom.js";

/** Section divider — the hairline between panel sections.
 *  Defaults to <hr>; pass "div" where the caller's layout relies on the
 *  block element (a grid row that must not carry the hr UA margin). */
const sectionDivider = (tag: "hr" | "div" = "hr"): HTMLElement =>
  dom.el(tag, { class: PANEL_CLASS.SECTION_DIVIDER });

/** Button row — a flex row holding one or more panel buttons. */
const buttonRow = (...children: HTMLElement[]): HTMLElement =>
  dom.el("div", { class: PANEL_CLASS.BTN_ROW }, ...children);

/** Panel button — the shared panel action button (Reset / Clear).
 *  type defaults to "button" so it never submits a form it isn't in. */
const panelButton = (opts: {
  label: string;
  className?: string;
  type?: "button" | "submit" | "reset";
}): HTMLButtonElement =>
  dom.el(
    "button",
    {
      type: opts.type ?? "button",
      class: [PANEL_CLASS.PANEL_BTN, opts.className].filter(Boolean).join(" "),
      "aria-label": opts.label,
    },
    opts.label,
  ) as HTMLButtonElement;

/** Close button — the header's dismiss affordance (icon + aria-label).
 *  Same recipe as the panel header's close button so the two cannot drift. */
const closeButton = (opts: {
  title: string;
  iconSvg: string;
  className?: string;
}): HTMLButtonElement =>
  dom.el(
    "button",
    {
      type: "button",
      class: [PANEL_CLASS.CLOSE_BTN, opts.className].filter(Boolean).join(" "),
      title: opts.title,
      "aria-label": opts.title,
    },
    { html: opts.iconSvg },
  ) as HTMLButtonElement;

export { buttonRow, closeButton, panelButton, sectionDivider };
