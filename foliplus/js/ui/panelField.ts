// ui/panelField — shared read-only field primitive for panel UIs.
//
// The style panel's original-colors mode and the filter panel's field row both
// show a value the panel cannot edit: a readout box with the form-control
// frame, no chevron, no focus ring and no pointer affordance. This builder is
// the one home for that box; each caller keeps the CSS hook class that carries
// its frame (the read-only frame is component-styled) and the accessible name
// of the value (a caption, a method label, a class-count label) stays at the
// call site because it names the specific readout.
//
// The form row / label / control builders are NOT here: `core/rampForm` (the
// Heatmap + LayerControl shared field/classes/scheme rows) depends on the
// `platform/form.ts` ones, so those stay in platform and ui/ only adds what a
// panel needs and core never imports.
import { FORM_CLASS } from "./formClassName.js";
import { PANEL_CLASS } from "./panelClassName.js";
import { dom } from "#platform/dom.js";

/** One read-only value box: the form-control frame with no interaction.
 *  `aria-disabled` defaults to true — the box cannot be opened, toggled or
 *  edited by definition (pass false only for a genuinely inert container that
 *  is still reachable). `role` is caller-supplied only where a stable
 *  accessible name is needed (role="group" for method/class-count readouts,
 *  role="img" for the colors bar); a bare div is a generic role and a generic
 *  role does not reliably expose an aria-label across AT/browsers, so the
 *  caller opts in only when it sets a name. The frame styling rides the
 *  caller's class (e.g. foliplus-style-fill-readonly), so no shared CSS
 *  recipe is introduced here. */
const readOnlyValue = (
  opts: { className?: string; role?: string; ariaDisabled?: boolean } = {},
  ...children: (string | HTMLElement)[]
): HTMLElement =>
  dom.el(
    "div",
    {
      class: [FORM_CLASS.INPUT_SKIN, PANEL_CLASS.READONLY, opts.className]
        .filter(Boolean)
        .join(" "),
      "aria-disabled":
        opts.ariaDisabled === undefined ? "true" : String(opts.ariaDisabled),
      ...(opts.role ? { role: opts.role } : {}),
    },
    ...children,
  );

export { readOnlyValue };
