// ui/checkbox — shared tri-state checkbox primitive.
//
// A checkbox is either binary (a layer row's own show/hide) or tri-state (a
// role / folder header that aggregates the visibility of its members: all on,
// all off, or a mix). The visual contract is one source: whichever state the
// caller hands us, the input's `checked` / `indeterminate` pair and its
// `aria-checked` are written together, so the painted box and what a screen
// reader announces can never drift.
//
// The change handler reports the PRE-CLICK state. The browser clears
// `indeterminate` before the change event fires, so reading the input inside
// the handler cannot recover the state the user actually saw; the primitive
// snapshots it on construction and refreshes it on every `update()`, so a
// header's toggle-all can decide "everything was on -> turn it all off" from
// the state that was painted, not the post-reset one. This is the invariant
// LayerControl's old inline handler worked around by re-reading the member
// layers; owning the snapshot here makes that workaround unnecessary for any
// future consumer.
//
// Does NOT import any control or core module: ui/ primitives are usable
// without a map, so this stays free of LayerControl/const.ts (that module
// reads the map's container at import time).
import { CHECKBOX_CLASS } from "./checkboxClassName.js";
import { dom } from "#platform/dom.js";

/** The three painted states of an aggregating checkbox. */
type TriState = "checked" | "unchecked" | "indeterminate";

/** Internal: the factory's options. Not exported — no consumer names the type. */
interface CheckboxOptions {
  /** Binary state when the box is not aggregating. Ignored when `triState`
   *  is given. */
  checked?: boolean;
  /** Tri-state when the box aggregates members (a role / folder header). */
  triState?: TriState;
  /** Accessible name. Omit when the consumer supplies its own label element
   *  and wires the association itself. */
  ariaLabel?: string;
  /** Extra attributes for the input (data-role, title, ...). Applied verbatim
   *  so the primitive stays free of any one control's vocabulary. */
  attributes?: Record<string, string>;
  /** Called on a USER toggle with the pre-click state. Never fires on a
   *  programmatic `update()`. */
  onChange?: (preClick: TriState) => void;
}

/** Internal: the factory's return. Not exported — consumers use the inferred shape. */
interface Checkbox {
  /** The layout wrapper (`foliplus-checkbox`) — mount this in the row/header. */
  host: HTMLElement;
  /** The native input the primitive owns. */
  input: HTMLInputElement;
  /** Repaint without firing onChange. Pass whichever of `checked` /
   *  `triState` / `ariaLabel` changed; omitted keys keep their value. */
  update: (next: {
    checked?: boolean;
    triState?: TriState;
    ariaLabel?: string | null;
  }) => void;
}

/** Resolve the tri-state an options object describes. `triState` wins over
 *  `checked` so an aggregate header stays explicit about the mix. */
const resolveState = (opts: { checked?: boolean; triState?: TriState }): TriState =>
  opts.triState ?? (opts.checked ? "checked" : "unchecked");

/** Write one tri-state onto the input: the `checked` / `indeterminate` pair
 *  and `aria-checked` together, so the paint and the announcement agree. */
const paint = (input: HTMLInputElement, state: TriState): void => {
  input.checked = state === "checked";
  input.indeterminate = state === "indeterminate";
  input.setAttribute(
    "aria-checked",
    state === "checked" ? "true" : state === "unchecked" ? "false" : "mixed",
  );
};

/** Repaint one tri-state onto an input the caller already holds (a header
 *  the list rebuilds in place, re-read by `input[type=checkbox]` rather than
 *  recreated). Same single paint the factory uses, so create-time and
 *  update-time boxes cannot drift about what a state looks like. */
const setCheckboxState = (input: HTMLInputElement, state: TriState): void => {
  paint(input, state);
};

/** Derive the tri-state from a `{ total, on }` visibility aggregate: all on
 *  -> checked, none on -> unchecked, a mix -> indeterminate. LayerControl's
 *  own projection vocabulary (a role / folder header aggregates its members);
 *  kept with the consumers rather than in the primitive, which stays free of
 *  any one control's aggregate shape. */
const triStateOf = (total: number, on: number): TriState => {
  const allChecked = total > 0 && on === total;
  if (allChecked) return "checked";
  return on === 0 ? "unchecked" : "indeterminate";
};

const createCheckbox = (opts: CheckboxOptions = {}): Checkbox => {
  const input = dom.el("input", {
    type: "checkbox",
    class: CHECKBOX_CLASS.INPUT,
  }) as HTMLInputElement;
  if (opts.ariaLabel !== undefined) input.setAttribute("aria-label", opts.ariaLabel);
  for (const [key, value] of Object.entries(opts.attributes ?? {})) {
    input.setAttribute(key, value);
  }
  // Snapshot the state we painted so the change handler can report the
  // pre-click state the user saw, not the browser's post-reset one.
  let current = resolveState(opts);
  paint(input, current);

  const host = dom.el("div", { class: CHECKBOX_CLASS.WRAPPER }, input) as HTMLElement;

  // listener-exempt: the input is owned by the returned host and dies with
  // it — no re-bind, no path for the listener to outlive the element.
  input.addEventListener("change", () => {
    const preClick = current;
    // Repaint from the browser's own post-toggle value for the binary case
    // (a native checkbox toggles itself), then re-snapshot so the next
    // toggle reports the state this paint left behind.
    current = input.indeterminate
      ? "indeterminate"
      : input.checked
        ? "checked"
        : "unchecked";
    paint(input, current);
    opts.onChange?.(preClick);
  });

  const update = (next: {
    checked?: boolean;
    triState?: TriState;
    ariaLabel?: string | null;
  }): void => {
    if (next.checked !== undefined || next.triState !== undefined) {
      current = resolveState({ ...opts, ...next });
      paint(input, current);
    }
    if (next.ariaLabel !== undefined) {
      if (next.ariaLabel === null) input.removeAttribute("aria-label");
      else input.setAttribute("aria-label", next.ariaLabel);
    }
  };

  return { host, input, update };
};

export { createCheckbox, setCheckboxState, triStateOf };
export type { TriState };
