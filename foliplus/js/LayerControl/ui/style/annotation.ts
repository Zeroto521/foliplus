// LayerControl style-panel — the Label section's dimension descriptor.
//
// Labels are a dimension of the layer's style, registered in the
// same discovery registry as fill / border / opacity / zoomRange instead
// of being a hand-written section in the panel assembly. The panel iterates
// `LABEL_DIM_ORDER` exactly like it iterates `DIM_ORDER` for the Layer
// section — heading plus each gated row.
//
// The gate is the registry contract's pure two-layer shape and nothing
// more: layer existence, then `capabilities.annotation !== "none"`. The
// labelable-fields question that makes the row honest is NOT asked here —
// it is encoded in the capability itself, decided once at the surface
// declaration edge (`LayerController.withAnnotationSpec` probes
// `hasLabelField`, appends the `role: "annotation"` PaneSpec iff the probe
// hits, and `detectCapabilities` reads that spec back). A second probe in
// the gate would be exactly the drift the gate invariant forbids.
import {
  AUTO_FIELD,
  numberFormatOptions,
  resolveSelectedField,
} from "#core/label/index.js";
import { CAP_TIER, DIM } from "#core/layer/index.js";
import * as CONST from "#foliplus/LayerControl/const.js";
import type { AnnotationConfig } from "#foliplus/LayerControl/type.js";
import { dom } from "#common/dom.js";
import {
  DEFAULT_LABEL_COLOR,
  LABEL_SIZE,
  clampLabelSize,
  colorInput as formColorInput,
  numberInput as formNumberInput,
  formRow,
  inlineControls,
  normalizeHexColor,
} from "#common/form.js";
import { NUMBER_FORMAT } from "#common/format.js";
import type { LayerUI } from "../surface.js";
import { layerFields, syncFormatRow } from "./label.js";
import { registerDimension } from "./registry.js";

/** Whether the layer's surface can honestly carry label content: the layer
 *  is registered (precondition guard) and its surface declared a label
 *  pane (`capabilities.annotation !== "none"` — the registration edge's
 *  `hasLabelField` probe already decided that, so this stays a pure
 *  capability bit). The ⋮ menu's Style item keys off the same function —
 *  one source for "can this layer show a Label section". */
const layerCanLabel = (ui: LayerUI, layerId: string): boolean => {
  const layerInfo = ui.c.layerRegistry.get(layerId);
  if (!layerInfo) return false;
  return ui.c.surfaceFor(layerInfo).capabilities.annotation !== CAP_TIER.NONE;
};

/** Build the Label section's rows: the label toggle, then the body (field
 *  picker → appearance → number format → avoid-overlap). Returned as the
 *  descriptor's `row`, so the panel assembly appends it under the section
 *  heading exactly like any other dimension's row — the wrapper div is the
 *  section's own; every control is found later by its class, never by
 *  structural position.
 *
 *  Body order is shared with the delegated drawer: data → appearance →
 *  format → behavior. Field first (label-only), then color/size, then
 *  number format, then avoid-overlap. */
const buildLabelSection = (ui: LayerUI, layerId: string): HTMLElement => {
  const fields = layerFields(ui, layerId);
  const cfg = ui.c.annotation.getConfig(layerId);
  const fmtLabel = (f: string) => ui._(`foliplus.label_format_${f}`) || f;
  // Labels are off by default — the user opens the panel, sees the field and
  // format chooser idle, and flips the switch to begin. `cfg.show ? "" : null`
  // follows the persisted state when this is a reopen, but the *first* open
  // never reads from storage (DEFAULT_ANNOTATION.show = false). The body
  // collapses under the toggle on first paint and on every reopen where
  // show === false, mirroring the heatmap's "switch off → hide body" rule.
  const showChecked = !!cfg.show;
  // The picker's "Auto" entry means "let foliplus choose", and the config
  // records it as the shared sentinel rather than a resolved name — so the layer
  // keeps labeling itself when its columns change. `resolveSelectedField`
  // (core/labelField) is what turns the select's value back into a field.
  const selectedField = cfg.field;

  // Field options: the auto entry first, then one per field. The auto entry is
  // the select's own empty value, so it is what a fresh panel shows, and it is
  // a disabled placeholder exactly like the heatmap's `field_auto`. Disabled
  // rather than merely first, so it reads as the current state instead of an
  // option to pick: the way back to auto is Reset, which restores the default
  // config. The per-field <option>s are appended to the select itself —
  // appending them into the first option would nest <option> inside <option>,
  // and the browser skips nested options when it builds the options list.
  const fieldSelect = dom.el(
    "select",
    {
      class: `foliplus-form-select ${CONST.CLASSES.STYLE_FIELD_SELECT}`,
      "aria-label": ui.T("style_label_field"),
    },
    dom.el(
      "option",
      { value: AUTO_FIELD, disabled: true },
      ui.T("style_label_field_auto"),
    ),
  );
  fields.forEach(f =>
    fieldSelect.appendChild(
      dom.el(
        "option",
        { value: f.name, selected: f.name === selectedField ? "" : null },
        f.name,
      ),
    ),
  );
  (fieldSelect as HTMLSelectElement).value = selectedField || AUTO_FIELD;

  // Appearance row — same chrome as the heatmap border / delegated drawer.
  const colorInput = formColorInput({
    value: normalizeHexColor(cfg.color || DEFAULT_LABEL_COLOR),
    className: CONST.CLASSES.STYLE_LABEL_COLOR_INPUT,
    ariaLabel: ui._("foliplus.label_color"),
  }) as HTMLInputElement;
  const sizeInput = formNumberInput({
    value: clampLabelSize(cfg.size || LABEL_SIZE.SIZE_DEFAULT),
    min: LABEL_SIZE.SIZE_MIN,
    max: LABEL_SIZE.SIZE_MAX,
    step: LABEL_SIZE.SIZE_STEP,
    className: CONST.CLASSES.STYLE_LABEL_SIZE_INPUT,
    ariaLabel: ui._("foliplus.label_size"),
  }) as HTMLInputElement;

  const formatOpts = numberFormatOptions(fmtLabel);

  // The toggle gets a focus-visible ring tied to the panel's design token,
  // not the browser default — without it, a tab stop on a switch looks
  // identical to "not focused", which is the heatmap-style bug we hit.
  const showToggle = dom.el("input", {
    type: "checkbox",
    class: CONST.CLASSES.STYLE_TOGGLE_INPUT,
    checked: showChecked ? "" : null,
    "aria-label": ui._("foliplus.label_tooltip"),
  });
  // "Avoid overlap": thins this layer's own labels where they collide. Labels
  // from *different* layers never avoid each other — the layers are stacked, so
  // an upper layer simply covers the lower one's.
  const collideToggle = dom.el("input", {
    type: "checkbox",
    class: CONST.CLASSES.STYLE_COLLIDE_INPUT,
    checked: cfg.collide ? "" : null,
    "aria-label": ui._("foliplus.label_collide_tooltip"),
  });
  const formatSelect = dom.el(
    "select",
    {
      class: `foliplus-form-select ${CONST.CLASSES.STYLE_FORMAT_SELECT}`,
      "aria-label": ui._("foliplus.label_format"),
    },
    ...formatOpts,
  );

  (formatSelect as HTMLSelectElement).value = cfg.format || NUMBER_FORMAT.AUTO;

  // Numeric-only: hide the format dropdown when the picked field is not a
  // number — comma/percent/int all render the same as auto in that case.
  const formatRow = dom.el(
    "div",
    { class: `${CONST.CLASSES.FORM_ROW} ${CONST.CLASSES.STYLE_FORMAT_ROW}` },
    dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui._("foliplus.label_format")),
    dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, formatSelect),
  );
  syncFormatRow(
    fields,
    formatRow,
    resolveSelectedField((fieldSelect as HTMLSelectElement).value, fields),
  );

  // Body wrapper: hidden by default when cfg.show is false, shown on toggle
  // on. Listens to the toggle so flipping it reveals the field/format rows
  // and auto-picks a field if none was selected yet (the "warm start" from
  // the heatmap's rule: open the gate, the first thing shows up).
  const body = dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_BODY },
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui.T("style_label_field")),
      dom.el("div", { class: CONST.CLASSES.FORM_CONTROL }, fieldSelect),
    ),
    formRow(ui._("foliplus.label_style"), inlineControls(colorInput, sizeInput)),
    formatRow,
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el(
        "label",
        { class: CONST.CLASSES.FORM_LABEL },
        ui._("foliplus.label_collide"),
      ),
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_CONTROL },
        dom.el(
          "label",
          { class: CONST.CLASSES.TOGGLE_SWITCH },
          collideToggle,
          dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
        ),
      ),
    ),
  );
  body.classList.toggle("foliplus-hidden", !showChecked);

  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_LABEL_SECTION },
    dom.el(
      "div",
      { class: CONST.CLASSES.FORM_ROW },
      dom.el("label", { class: CONST.CLASSES.FORM_LABEL }, ui._("foliplus.label")),
      dom.el(
        "div",
        { class: CONST.CLASSES.FORM_CONTROL },
        // Resolving the toggle: clicking the input, the slider span, or the
        // label should all flip the checkbox — the switch is one <label>.
        dom.el(
          "label",
          { class: CONST.CLASSES.TOGGLE_SWITCH },
          showToggle,
          dom.el("span", { class: CONST.CLASSES.TOGGLE_SLIDER }),
        ),
      ),
    ),
    body,
  );
};

/** The Label section's registry entry. `value` hands back the resolved
 *  config (user's stored choice merged over the defaults) — what a future
 *  schema-style consumer reads without re-deriving it. */
const ANNOTATION_DIMENSION = registerDimension<AnnotationConfig>({
  key: DIM.ANNOTATION,
  gate: layerCanLabel,
  value: (ui, layerId) => ui.c.annotation.getConfig(layerId),
  row: buildLabelSection,
});

export { ANNOTATION_DIMENSION, layerCanLabel };
