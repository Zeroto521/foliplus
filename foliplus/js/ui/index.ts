// ui/ — panel appearance composition layer.
//
// Single export surface for the panel UI primitives. Consumers and tests
// import from "#ui/index.js" — never from a specific ui module directly —
// so the panel shell owns the namespace shape and a module rename here does
// not ripple through call sites. The index *is* the directory's export point;
// a re-export layer beyond it (an alias module forwarding another file, or a
// second barrel) is what the layering keeps out.
export { buttonRow, closeButton, panelButton, sectionDivider } from "./panelChrome.js";
export { applyOptionA11y, createDropdown, dropdownOf } from "./dropdown.js";
export type { Dropdown, DropdownSurface } from "./dropdown.js";
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
export type { Placement, PlacementOpts, Rect, SurfaceSize } from "./placement.js";
export { createSchemePicker } from "./schemePicker.js";
export type { SchemePicker } from "./schemePicker.js";
export { readOnlyValue } from "./panelField.js";
export { Slider, finishSlidersIn, sliderOf } from "./slider.js";
export type { SliderOptions } from "./slider.js";
export { SLIDER } from "./sliderVocabulary.js";
export { STYLE_MODE } from "./styleVocabulary.js";
