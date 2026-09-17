// common/form — shared form-control builders for panel UIs.
// HeatmapControl's template and LayerControl's style drawer both need the
// same color / number pair; one factory keeps classes, bounds and defaults
// from drifting.
import { dom } from "./dom.js";

/** Expand #rgb to #rrggbb so `<input type=color>` accepts Python's "#fff". */
const normalizeHexColor = (value: string): string => {
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const [r, g, b] = value.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return value;
};

/** `<input type=color>` on the shared form-color-input chrome. */
const colorInput = (opts: {
  value?: string;
  className?: string;
  ariaLabel?: string;
}): HTMLElement =>
  dom.el("input", {
    type: "color",
    class: `foliplus-form-color-input${opts.className ? ` ${opts.className}` : ""}`,
    value: normalizeHexColor(opts.value ?? "#ffffff"),
    "aria-label": opts.ariaLabel,
  });

/** `<input type=number>` on the shared form-number-input chrome. */
const numberInput = (opts: {
  value: number;
  min: number;
  max: number;
  step?: number;
  className?: string;
  ariaLabel?: string;
}): HTMLElement =>
  dom.el("input", {
    type: "number",
    class: `foliplus-form-number-input${opts.className ? ` ${opts.className}` : ""}`,
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step ?? 1),
    value: String(opts.value),
    "aria-label": opts.ariaLabel,
  });

/** Two controls sharing one form-control cell (border / label color+size). */
const inlineControls = (...children: HTMLElement[]): HTMLElement =>
  dom.el("div", { class: "foliplus-form-inline" }, ...children);

/** Live number input: apply in-range values on every keystroke; on commit
 *  (change) clamp into [min, max] and rewrite the field. Shared by border
 *  weight and label size so both behave identically. */
const bindLiveNumber = (
  input: HTMLInputElement,
  opts: {
    min: number;
    max: number;
    fallback: number;
    onCommit: (value: number) => void;
  },
): void => {
  input.oninput = () => {
    const v = parseFloat(input.value);
    if (!Number.isNaN(v) && v >= opts.min && v <= opts.max) opts.onCommit(v);
  };
  input.onchange = () => {
    const v = parseFloat(input.value);
    const clamped = Number.isNaN(v)
      ? opts.fallback
      : Math.min(opts.max, Math.max(opts.min, v));
    input.value = String(clamped);
    opts.onCommit(clamped);
  };
};

/** Live color input — every picker movement commits. */
const bindLiveColor = (
  input: HTMLInputElement,
  onCommit: (value: string) => void,
): void => {
  input.oninput = () => onCommit(input.value);
};

export {
  bindLiveColor,
  bindLiveNumber,
  colorInput,
  inlineControls,
  normalizeHexColor,
  numberInput,
};
