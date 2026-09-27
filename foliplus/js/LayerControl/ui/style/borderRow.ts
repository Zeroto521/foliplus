// Shared border-row form builder. Two callers — vector's `setStyle` walk and
// a delegated component's `styleSetters` — both need a color swatch + a width
// number input wired to a live commit path; the row shell and the input
// chrome live here, and each caller supplies its own write target.
//
// `buildBorderRow` and `bindBorderRow` take separate targets on purpose: the
// build side needs shell/chrome options, the bind side needs write callbacks.
// Folding them into one target would force the bind caller to supply dummy
// shell fields and vice versa.
//
// Build side:
//   - `label` — resolved row label (`ui.T("border")` on either caller).
//   - `rowClass` — full `class` string on the row. Vector passes
//     `FORM_ROW + STYLE_BORDER_ROW` (that hook is what `openStylePanel` and
//     the vector tests query for); delegated passes plain `FORM_ROW` so a
//     delegated border row never carries the vector class and the two
//     panels cannot collide on the same selector.
//   - `color` / `weight` — initial values. Vector pre-resolves to hex via
//     its `displayColor` helper (named / functional CSS forms → `#rrggbb`);
//     delegated passes the styleProvider's own value through.
//   - `hasColorInput` / `hasWeightInput` — whether to render each input at
//     all. Vector publishes both; delegated publishes whatever the component
//     exposes through `styleSetters`.
//   - `className` / `weightClassName` — optional. Vector passes
//     `STYLE_BORDER_COLOR_INPUT` / `STYLE_BORDER_WEIGHT_INPUT` so tests and
//     callers can key off a stable selector; delegated leaves them undefined
//     and `form` applies its own plain chrome. `bindBorderRow` uses the same
//     values to find the inputs on an existing row.
//   - `colorAria` / `weightAria` — optional aria-labels. Vector passes both;
//     delegated passes undefined (its inputs were never annotated, and no
//     test asserts on them either). `dom.el` drops null attributes, so
//     `undefined` here is a pass-through.
//
// Bind side:
//   - `onChangeColor` / `onChangeWeight` — the write target for each input.
//     Vector routes to `commitBorderColor` / `commitBorderWeight` (map +
//     override + `setStyle` + highlight pin); delegated routes to
//     `entry()?.styleSetters?.xxx` so a layer re-registered mid-interaction
//     no-ops cleanly. Absent = the input is not bound (build side would not
//     have rendered it either).
//   - `className` / `weightClassName` — same as build side; used to pick
//     `input.<class>` over the generic `input[type=color]` /
//     `input[type=number]` fallback when the caller opted into the hooks.
//
// The row shell (`FORM_ROW` + `FORM_LABEL` + `FORM_CONTROL` + `inlineControls`)
// and the bind recipe (`bindLiveColor` / `bindLiveNumber`) are shared so a
// border row reads identically whether it paints through `setStyle` or
// through a component's own canvas.
//
// `buildBorderRow` builds the DOM and returns it; it does NOT attach live
// binders. `bindBorderRow` finds the inputs on a row and attaches the live
// binders to them — called by the vector wrapper on the same row that
// `buildBorderRow` returned, and separately by `openStylePanel` after the
// panel is appended (the pre-merge two-step recipe). `bindBorderRow` on a
// row with no matching inputs (a bare test stub) is a no-op.
import { dom } from "#common/dom.js";
import {
  BORDER_WEIGHT,
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  inlineControls,
  numberInput,
} from "#common/form.js";
import * as CONST from "../../const.js";

export interface BorderRowBuildTarget {
  /** Resolved row label text. */
  label: string;
  /** Row `class` — `FORM_ROW` plus any caller-specific hook (vector adds
   *  `STYLE_BORDER_ROW`). */
  rowClass: string;
  /** Initial color value (already display-ready for the swatch). */
  color?: string;
  /** Initial width value. */
  weight: number;
  /** Present iff a color input should render. */
  hasColorInput?: boolean;
  /** Present iff a width input should render. */
  hasWeightInput?: boolean;
  /** Optional color input `class` — vector passes
   *  `STYLE_BORDER_COLOR_INPUT`; delegated leaves it undefined. */
  className?: string;
  /** Optional weight input `class` — see `className`. */
  weightClassName?: string;
  /** Optional aria-label for the color swatch. */
  colorAria?: string;
  /** Optional aria-label for the width input. */
  weightAria?: string;
}

export interface BorderRowBindTarget {
  /** Write callback for the color input. */
  onChangeColor?: (value: string) => void;
  /** Write callback for the width input. */
  onChangeWeight?: (value: number) => void;
  /** Same class hook the build side used on the color input. */
  className?: string;
  /** Same class hook the build side used on the weight input. */
  weightClassName?: string;
}

const colorSelector = (className?: string) =>
  className ? `input.${className}` : "input[type=color]";
const weightSelector = (className?: string) =>
  className ? `input.${className}` : "input[type=number]";

export const buildBorderRow = (target: BorderRowBuildTarget): HTMLElement => {
  const parts: HTMLElement[] = [];
  if (target.hasColorInput) {
    parts.push(
      colorInput({
        value: target.color,
        className: target.className,
        ariaLabel: target.colorAria,
      }),
    );
  }
  if (target.hasWeightInput) {
    parts.push(
      numberInput({
        value: target.weight,
        min: BORDER_WEIGHT.MIN,
        max: BORDER_WEIGHT.MAX,
        step: BORDER_WEIGHT.STEP,
        className: target.weightClassName,
        ariaLabel: target.weightAria,
      }),
    );
  }

  return dom.el(
    "div",
    { class: target.rowClass },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, target.label),
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_CONTROL },
      inlineControls(...parts),
    ),
  );
};

export const bindBorderRow = (
  row: HTMLElement,
  target: BorderRowBindTarget,
): void => {
  const colorEl = row.querySelector(colorSelector(target.className)) as
    | HTMLInputElement
    | null;
  if (colorEl && target.onChangeColor) {
    bindLiveColor(colorEl, value => target.onChangeColor?.(value));
  }
  const weightEl = row.querySelector(weightSelector(target.weightClassName)) as
    | HTMLInputElement
    | null;
  if (weightEl && target.onChangeWeight) {
    bindLiveNumber(weightEl, {
      min: BORDER_WEIGHT.MIN,
      max: BORDER_WEIGHT.MAX,
      fallback: BORDER_WEIGHT.DEFAULT,
      onCommit: value => target.onChangeWeight?.(value),
    });
  }
};
