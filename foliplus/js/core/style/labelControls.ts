// Shared label-style controls — one renderer for the heatmap panel's label
// section and LayerControl's delegated style drawer. Both render the same
// toggle + color/size + format + collide vocabulary, dispatch changes to the
// same styleSetters, and refresh from the same styleProvider on
// LAYER_STYLE_CHANGE; this module is the single home for that logic.
import { dom } from "#common/dom.js";
import {
  LABEL_COLOR_DEFAULT,
  LABEL_SIZE,
  bindLiveColor,
  bindLiveNumber,
  colorInput as formColorInput,
  numberInput as formNumberInput,
  inlineControls,
} from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";

/** CSS class names — the same vocabulary the annotation panel and the
 *  delegated drawer use. Defined here (not imported from a component const)
 *  because the shared runtime cannot depend on a component module. */
const CLS = {
  FORM_ROW: "foliplus-form-row",
  FORM_LABEL: "foliplus-form-label",
  FORM_CONTROL: "foliplus-form-control",
  TOGGLE_SWITCH: "foliplus-toggle-switch",
  TOGGLE_SLIDER: "foliplus-toggle-slider",
  HIDDEN: "foliplus-hidden",
  STYLE_TOGGLE_INPUT: "foliplus-style-toggle-input",
  STYLE_BODY: "foliplus-style-body",
  STYLE_FORMAT_ROW: "foliplus-style-format-row",
  STYLE_FORMAT_SELECT: "foliplus-style-format-select",
  STYLE_COLLIDE_INPUT: "foliplus-style-collide-input",
  STYLE_LABEL_COLOR_INPUT: "foliplus-style-label-color-input",
  STYLE_LABEL_SIZE_INPUT: "foliplus-style-label-size-input",
} as const;

/** Style value shape read from a component's styleProvider. */
interface LabelStyleValues {
  labelShow?: boolean;
  labelColor?: string;
  labelSize?: number;
  labelFormat?: string;
  labelCollide?: boolean;
}

/** Style setter shape — each function applies one style change. */
type StyleSetters = Partial<{
  labelShow: (v: boolean) => void;
  labelColor: (v: string) => void;
  labelSize: (v: number) => void;
  labelFormat: (v: string) => void;
  labelCollide: (v: boolean) => void;
}>;

interface RenderLabelControlsOptions {
  /** Live style values. Returning undefined means "no values to publish" —
   *  refresh leaves every control untouched rather than resetting to defaults. */
  styleProvider: () => LabelStyleValues | undefined;
  /** Live setter lookup — read at event time so a layer torn down between
   *  open and interaction no-ops (the setter map is gone). */
  getSetters: () => StyleSetters;
  T: (key: string) => string;
}

interface LabelControlsResult {
  /** Root element wrapping the toggle row + body. Append this into the panel. */
  root: HTMLElement;
  /** Read styleProvider() and write every control, skipping the one under
   *  activeElement. Call on LAYER_STYLE_CHANGE so a remote change (the other
   *  panel, or the component's own setter emitting back) is mirrored here. */
  refresh: () => void;
}

/** One `<option>` per NUMBER_FORMAT entry — shared by the annotation panel
 *  and the label controls so every dropdown stays in lockstep with the type. */
const numberFormatOptions = (fmtLabel: (f: string) => string): HTMLElement[] =>
  Object.values(NUMBER_FORMAT).map(f => dom.el("option", { value: f }, fmtLabel(f)));

/** Render the shared label controls: a show toggle, a body (color/size,
 *  format, collide) that collapses when the toggle is off, and a unified
 *  change dispatcher + refresh. Renders only the controls whose setter the
 *  component declared, so the heatmap panel (no collide) and a generic
 *  delegated layer (all five) both get exactly what they publish. */
const renderLabelControls = (opts: RenderLabelControlsOptions): LabelControlsResult => {
  const { styleProvider, getSetters, T } = opts;
  const styleSetters = getSetters();
  const values = styleProvider() ?? {};
  const showChecked = !!values.labelShow;

  const bodyRows: HTMLElement[] = [];

  // Color + size share one row (same recipe as the heatmap border row).
  // Order under the toggle: appearance, then number format, then collide.
  if (styleSetters.labelColor || styleSetters.labelSize) {
    const colorInput = styleSetters.labelColor
      ? formColorInput({
          value:
            typeof values.labelColor === "string"
              ? values.labelColor
              : LABEL_COLOR_DEFAULT,
          className: CLS.STYLE_LABEL_COLOR_INPUT,
          ariaLabel: T("style_label_color"),
        })
      : null;
    const sizeInput = styleSetters.labelSize
      ? formNumberInput({
          value:
            typeof values.labelSize === "number"
              ? values.labelSize
              : LABEL_SIZE.SIZE_DEFAULT,
          min: LABEL_SIZE.SIZE_MIN,
          max: LABEL_SIZE.SIZE_MAX,
          step: LABEL_SIZE.SIZE_STEP,
          className: CLS.STYLE_LABEL_SIZE_INPUT,
          ariaLabel: T("style_label_size"),
        })
      : null;
    // Live on input, clamp on commit — same bindLive* recipe as the
    // heatmap panel so out-of-range sizes rewrite the field to the bound.
    if (colorInput) {
      bindLiveColor(colorInput as HTMLInputElement, value => {
        getSetters().labelColor?.(value);
      });
    }
    if (sizeInput) {
      bindLiveNumber(sizeInput as HTMLInputElement, {
        min: LABEL_SIZE.SIZE_MIN,
        max: LABEL_SIZE.SIZE_MAX,
        fallback: LABEL_SIZE.SIZE_DEFAULT,
        onCommit: value => getSetters().labelSize?.(value),
      });
    }
    const inline = inlineControls(
      ...(colorInput ? [colorInput] : []),
      ...(sizeInput ? [sizeInput] : []),
    );
    bodyRows.push(
      dom.el(
        "div",
        { class: CLS.FORM_ROW },
        dom.el("label", { class: CLS.FORM_LABEL }, T("style_label_style")),
        dom.el("div", { class: CLS.FORM_CONTROL }, inline),
      ),
    );
  }

  // Number format lives under the label toggle — collapses with the body.
  if (styleSetters.labelFormat) {
    const fmtLabel = (f: string) => T(`style_label_format_${f}`) || f;
    const formatSelect = dom.el(
      "select",
      {
        class: `foliplus-form-select ${CLS.STYLE_FORMAT_SELECT}`,
        "aria-label": T("style_label_format"),
      },
      ...numberFormatOptions(fmtLabel),
    );
    (formatSelect as HTMLSelectElement).value =
      typeof values.labelFormat === "string" ? values.labelFormat : NUMBER_FORMAT.AUTO;
    bodyRows.push(
      dom.el(
        "div",
        { class: `${CLS.FORM_ROW} ${CLS.STYLE_FORMAT_ROW}` },
        dom.el("label", { class: CLS.FORM_LABEL }, T("style_label_format")),
        dom.el("div", { class: CLS.FORM_CONTROL }, formatSelect),
      ),
    );
  }

  if (styleSetters.labelCollide) {
    const toggle = dom.el("input", {
      type: "checkbox",
      class: CLS.STYLE_COLLIDE_INPUT,
      checked: values.labelCollide !== false ? "" : null,
      "aria-label": T("style_label_collide_tooltip"),
    });
    bodyRows.push(
      dom.el(
        "div",
        { class: CLS.FORM_ROW },
        dom.el("label", { class: CLS.FORM_LABEL }, T("style_label_collide")),
        dom.el(
          "div",
          { class: CLS.FORM_CONTROL },
          dom.el(
            "label",
            { class: CLS.TOGGLE_SWITCH },
            toggle,
            dom.el("span", { class: CLS.TOGGLE_SLIDER }),
          ),
        ),
      ),
    );
  }

  const rows: HTMLElement[] = [];

  // The show toggle sits above the body; it collapses everything below.
  if (styleSetters.labelShow) {
    const toggle = dom.el("input", {
      type: "checkbox",
      class: CLS.STYLE_TOGGLE_INPUT,
      checked: showChecked ? "" : null,
      "aria-label": T("style_label_tooltip"),
    });
    rows.push(
      dom.el(
        "div",
        { class: CLS.FORM_ROW },
        dom.el("label", { class: CLS.FORM_LABEL }, T("style_label")),
        dom.el(
          "div",
          { class: CLS.FORM_CONTROL },
          dom.el(
            "label",
            { class: CLS.TOGGLE_SWITCH },
            toggle,
            dom.el("span", { class: CLS.TOGGLE_SLIDER }),
          ),
        ),
      ),
    );
  }

  // Body wrapper: collapsed when the toggle is off — same "switch off → hide
  // body" rule the annotation panel uses.
  if (bodyRows.length) {
    const body = dom.el("div", { class: CLS.STYLE_BODY }, ...bodyRows);
    body.classList.toggle(CLS.HIDDEN, !showChecked);
    rows.push(body);
  }

  const root = dom.el("div", {}, ...rows);

  // Change delegation on the root: toggle, format, collide. Color/size are
  // bound live at render time — the change event would double-commit.
  // stopPropagation keeps the change out of any panel-level delegation
  // (LayerControl's container reads changes as visibility toggles).
  root.addEventListener("change", (event: Event) => {
    const t = event.target as HTMLElement;
    // Re-read at event time: a layer torn down while the panel is open has
    // its setter map cleared, and the change must no-op rather than dispatch
    // into a dead component.
    const setters = getSetters();
    if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CLS.STYLE_TOGGLE_INPUT) &&
      setters.labelShow
    ) {
      const body = root.querySelector(`.${CLS.STYLE_BODY}`) as HTMLElement | null;
      if (body) body.classList.toggle(CLS.HIDDEN, !t.checked);
      setters.labelShow(t.checked);
    } else if (
      t instanceof HTMLInputElement &&
      t.classList.contains(CLS.STYLE_COLLIDE_INPUT) &&
      setters.labelCollide
    ) {
      setters.labelCollide(t.checked);
    } else if (
      t instanceof HTMLSelectElement &&
      t.classList.contains(CLS.STYLE_FORMAT_SELECT) &&
      setters.labelFormat
    ) {
      setters.labelFormat(t.value);
    } else {
      return;
    }
    event.stopPropagation();
  });

  const refresh = (): void => {
    const v = styleProvider();
    if (!v) return;
    const showInput = root.querySelector(
      `.${CLS.STYLE_TOGGLE_INPUT}`,
    ) as HTMLInputElement | null;
    if (showInput && document.activeElement !== showInput) {
      showInput.checked = !!v.labelShow;
    }
    // Body follows the toggle: a remote show/off (the other panel, or the
    // component's own setter emitting back) must collapse the body too.
    const body = root.querySelector(`.${CLS.STYLE_BODY}`) as HTMLElement | null;
    if (body) body.classList.toggle(CLS.HIDDEN, !v.labelShow);

    const collideInput = root.querySelector(
      `.${CLS.STYLE_COLLIDE_INPUT}`,
    ) as HTMLInputElement | null;
    if (collideInput && document.activeElement !== collideInput) {
      collideInput.checked = v.labelCollide !== false;
    }
    const colorEl = root.querySelector(
      `.${CLS.STYLE_LABEL_COLOR_INPUT}`,
    ) as HTMLInputElement | null;
    if (colorEl && document.activeElement !== colorEl) {
      if (typeof v.labelColor === "string") colorEl.value = v.labelColor;
    }
    const sizeEl = root.querySelector(
      `.${CLS.STYLE_LABEL_SIZE_INPUT}`,
    ) as HTMLInputElement | null;
    if (sizeEl && document.activeElement !== sizeEl) {
      if (typeof v.labelSize === "number") sizeEl.value = String(v.labelSize);
    }
    const formatSelect = root.querySelector(
      `.${CLS.STYLE_FORMAT_SELECT}`,
    ) as HTMLSelectElement | null;
    if (formatSelect && document.activeElement !== formatSelect) {
      formatSelect.value =
        typeof v.labelFormat === "string" ? v.labelFormat : NUMBER_FORMAT.AUTO;
    }
  };

  return { root, refresh };
};

export {
  type LabelStyleValues,
  type StyleSetters,
  type RenderLabelControlsOptions,
  type LabelControlsResult,
  numberFormatOptions,
  renderLabelControls,
};
