// LayerControl style-panel — the Label section's dimension descriptor.
//
// Labels are a dimension of the layer's style, registered in the
// same discovery registry as fill / border / opacity / zoomRange instead
// of being a hand-written section in the panel assembly. The panel iterates
// `LABEL_DIM_ORDER` exactly like it iterates `DIM_ORDER` for the Layer
// section — heading plus each gated row.
//
// The gate is the registry contract's pure two-layer shape and nothing
// more: layer existence, then `capabilities.label !== "none"`. The
// labelable-fields question that makes the row honest is NOT asked here —
// it is encoded in the capability itself, decided once at the surface
// declaration edge (`LayerController.withLabelSpec` probes
// `hasLabelField`, appends the `role: "label"` PaneSpec iff the probe
// hits, and `detectCapabilities` reads that spec back). A second probe in
// the gate would be exactly the drift the gate invariant forbids.
import type { LayerUI } from "../surface.js";
import { layerFields, replayLabelState, syncFormatRow } from "./label.js";
import { capabilityGate, registerDimension } from "./registry.js";
import { FACE } from "./styleBag.js";
import { numberFormatOptions, resolveSelectedField } from "#core/label/index.js";
import { DIM } from "#core/layer/index.js";
import { ensureOverlayRegistry } from "#core/overlay/index.js";
import { dom } from "#platform/dom.js";
import { NUMBER_FORMAT, withUnit } from "#platform/format.js";
import { dropdownSurface } from "#platform/fullscreen.js";
import {
  DEFAULT_LABEL_COLOR,
  FORM_CLASS,
  LABEL_SIZE,
  PANEL_CLASS,
  clampLabelSize,
  createDropdown,
  dropdownOverlay,
  colorInput as formColorInput,
  numberInput as formNumberInput,
  formRow,
  inlineControls,
  normalizeHexColor,
  selectInput,
} from "#ui/index.js";
import * as CONST from "#control/LayerControl/const.js";
import type { LabelConfig } from "#control/LayerControl/type.js";

/** Whether the layer's surface can honestly carry label content: the layer
 *  is registered (precondition guard) and its surface declared a label
 *  pane (`capabilities.label !== "none"` — the registration edge's
 *  `hasLabelField` probe already decided that, so this stays a pure
 *  capability bit). The ⋮ menu's Style item keys off the same function —
 *  one source for "can this layer show a Label section". */
const layerCanLabel = capabilityGate("label", "non-none");

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
  const cfg = ui.c.label.getConfig(layerId);
  const fmtLabel = (f: string) => ui._(`foliplus.label_format_${f}`) || f;
  // Labels are off by default — the user opens the panel, sees the field and
  // format chooser idle, and flips the switch to begin. `cfg.show ? "" : null`
  // follows the persisted state when this is a reopen, but the *first* open
  // never reads from storage (DEFAULT_LABEL.show = false). The body
  // collapses under the toggle on first paint and on every reopen where
  // show === false, mirroring the heatmap's "switch off → hide body" rule.
  const showChecked = !!cfg.show;
  // The field the picker shows: the stored one while the layer still offers it,
  // otherwise the layer's default pick (first numeric, else first). Resolved on
  // every paint and never written back here — opening the panel is not a
  // choice, so the config keeps whatever the user picked (or nothing, which
  // keeps resolving to the default if the layer's columns change).
  const selectedField = resolveSelectedField(cfg.field, fields);

  // Field options: one per real field, with the resolved field selected. There
  // is no "Auto"/placeholder entry: the picker always names a concrete column,
  // and the default above is already a field. The <option>s are appended to the
  // select itself, never nested inside an option.
  const fieldSelect = selectInput({
    className: CONST.CLASSES.STYLE_FIELD_SELECT,
    ariaLabel: ui.T("style_label_field"),
    value: selectedField,
    options: fields.map(f => ({ value: f.name, label: f.name })),
  });
  // The visible picker is the shared dropdown; the select stays mounted
  // (hidden) as the value/change bridge the panel delegates on.
  const fieldDropdown = createDropdown({
    nativeSelect: fieldSelect as HTMLSelectElement,
    ariaLabel: ui.T("style_label_field"),
    ...dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });

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
    ariaLabel: withUnit(ui._("foliplus.label_size"), ui._("foliplus.unit_px")),
    unitSuffix: ui._("foliplus.unit_px"),
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
    // Same `!== false` rule the renderer and MeasureControl use, so an
    // undeclared config (page-level default true) reads as checked.
    checked: cfg.collide !== false ? "" : null,
    "aria-label": ui._("foliplus.label_collide_tooltip"),
  });
  const formatSelect = dom.el(
    "select",
    {
      class: `${FORM_CLASS.INPUT_SKIN} ${FORM_CLASS.FORM_SELECT} ${CONST.CLASSES.STYLE_FORMAT_SELECT}`,
      "aria-label": ui._("foliplus.label_format"),
    },
    ...formatOpts,
  );
  (formatSelect as HTMLSelectElement).value = cfg.format || NUMBER_FORMAT.AUTO;
  const formatDropdown = createDropdown({
    nativeSelect: formatSelect as HTMLSelectElement,
    ariaLabel: ui._("foliplus.label_format"),
    ...dropdownSurface(ui.c.map.getContainer()),
    overlay: dropdownOverlay(ensureOverlayRegistry(ui.c.map)),
  });

  // Numeric-only: hide the format dropdown when the picked field is not a
  // number — comma/percent/int all render the same as auto in that case.
  const formatRow = dom.el(
    "div",
    { class: `${PANEL_CLASS.FORM_ROW} ${CONST.CLASSES.STYLE_FORMAT_ROW}` },
    dom.el("label", { class: PANEL_CLASS.FORM_LABEL }, ui._("foliplus.label_format")),
    dom.el("div", { class: PANEL_CLASS.FORM_CONTROL }, formatDropdown.element),
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
      { class: PANEL_CLASS.FORM_ROW },
      dom.el("label", { class: PANEL_CLASS.FORM_LABEL }, ui.T("style_label_field")),
      dom.el("div", { class: PANEL_CLASS.FORM_CONTROL }, fieldDropdown.element),
    ),
    formRow(ui._("foliplus.label_style"), inlineControls(colorInput, sizeInput)),
    formatRow,
    dom.el(
      "div",
      { class: PANEL_CLASS.FORM_ROW },
      dom.el(
        "label",
        { class: PANEL_CLASS.FORM_LABEL },
        ui._("foliplus.label_collide"),
      ),
      dom.el(
        "div",
        { class: PANEL_CLASS.FORM_CONTROL },
        dom.el(
          "label",
          { class: PANEL_CLASS.TOGGLE_SWITCH },
          collideToggle,
          dom.el("span", { class: PANEL_CLASS.TOGGLE_SLIDER }),
        ),
      ),
    ),
  );
  body.classList.toggle(PANEL_CLASS.HIDDEN, !showChecked);

  return dom.el(
    "div",
    { class: CONST.CLASSES.STYLE_LABEL_SECTION },
    dom.el(
      "div",
      { class: PANEL_CLASS.FORM_ROW },
      dom.el("label", { class: PANEL_CLASS.FORM_LABEL }, ui._("foliplus.label")),
      dom.el(
        "div",
        { class: PANEL_CLASS.FORM_CONTROL },
        // Resolving the toggle: clicking the input, the slider span, or the
        // label should all flip the checkbox — the switch is one <label>.
        dom.el(
          "label",
          { class: PANEL_CLASS.TOGGLE_SWITCH },
          showToggle,
          dom.el("span", { class: PANEL_CLASS.TOGGLE_SLIDER }),
        ),
      ),
    ),
    body,
  );
};

/** The Label section's registry entry. `value` hands back the resolved
 *  config (user's stored choice merged over the defaults) — what a future
 *  schema-style consumer reads without re-deriving it. */
const LABEL_DIMENSION = registerDimension<LabelConfig>({
  key: DIM.LABEL,
  gate: layerCanLabel,
  value: (ui, layerId) => ui.c.label.getConfig(layerId),
  row: buildLabelSection,
  /** Content-change replay: labels rebuild from the tree the change just
   *  landed — the most expensive of the replays (full walk + canvas
   *  repaint), so it rides the frame coalescer: a streamed addData pays
   *  one rebuild per frame, not one per feature. The when-gate keeps a
   *  layer with labels off from allocating a box at all. */
  contentChange: {
    kind: "frame",
    face: FACE.LABEL,
    when: (ui, layerId) => ui.c.label.getConfig(layerId).show,
    run: (ui, layerId) => replayLabelState(ui, layerId),
  },
});

export { LABEL_DIMENSION, layerCanLabel };
