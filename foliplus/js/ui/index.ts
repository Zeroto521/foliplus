// ui/ — panel appearance composition layer.
//
// Single export surface for the panel UI primitives. Consumers and tests
// import from "./index.js" — never from a specific ui module directly —
// so the panel shell owns the namespace shape and a module rename here does
// not ripple through call sites. The index *is* the directory's export point;
// a re-export layer beyond it (an alias module forwarding another file, or a
// second barrel) is what the layering keeps out.
export { buttonRow, closeButton, panelButton, sectionDivider } from "./panelChrome.js";
export {
  drawCanvasLabel,
  prepareCanvasLabel,
  resolveCanvasLabelStyle,
  withLabelPaint,
} from "./canvasLabel.js";
export { nextOptionId } from "./optionRow.js";
export { PANEL_CLASS } from "./panelClassName.js";
export {
  DROPDOWN_OVERLAY_ID,
  POPUP_ESCAPE_DELTA,
  POPUP_HOST_RANK,
  POPUP_OVERLAY_RANK,
  applyOptionRowA11y,
  createDropdown,
  dropdownOf,
  dropdownOverlay,
} from "./dropdown.js";
export type { DropdownOverlay } from "./dropdown.js";
export { createListbox } from "./listbox.js";
export {
  bindLiveColor,
  bindLiveNumber,
  BORDER_WEIGHT,
  clampBorderWeight,
  clampLabelSize,
  colorInput,
  formRow,
  inlineControls,
  DEFAULT_LABEL_COLOR,
  LABEL_SIZE,
  normalizeHexColor,
  numberInput,
  selectInput,
} from "./form.js";
export { clamp, computePlacement, intersect, isDegenerate } from "./placement.js";
export { createSchemePicker } from "./schemePicker.js";
export { readOnlyValue } from "./panelField.js";
export { Slider, finishSlidersIn, sliderOf } from "./slider.js";
export { SLIDER_CLASS } from "./sliderClassName.js";
export { ensureActiveVisible } from "./scrollIntoView.js";
export { STYLE_MODE } from "./styleModeKey.js";
export type {
  CanvasLabelStyle,
  Dropdown,
  DropdownSurface,
  Placement,
  PlacementOpts,
  PlacementBox,
  SurfaceSize,
  SchemePicker,
  SliderOptions,
} from "./type.js";
