// core/label — the label trio: collision geometry, control renderer, field
// resolution. Consumers import one barrel instead of three sibling modules.
export { HIDE_OVERLAP, hides, planVisible, withinRect } from "./labelCollision.js";
export type { Box } from "./labelCollision.js";
export { numberFormatOptions, renderLabelControls } from "./labelControl.js";
export type { LabelStyleValues } from "./labelControl.js";
export {
  bareFieldName,
  collectLabelFields,
  defaultLabelField,
  hasLabelField,
  isNumericField,
  resolveSelectedField,
} from "./labelField.js";
export type { LabelField } from "./labelField.js";
