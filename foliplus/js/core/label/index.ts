// core/label — the label trio: collision geometry, control renderer, field
// resolution. Consumers import one barrel instead of three sibling modules.
export {
  HIDE_OVERLAP,
  hides,
  planVisible,
  withinRect,
  type Box,
} from "./labelCollision.js";
export {
  numberFormatOptions,
  renderLabelControls,
  type LabelStyleValues,
} from "./labelControl.js";
export {
  AUTO_FIELD,
  autoLabelField,
  bareFieldName,
  collectLabelFields,
  hasLabelField,
  isNumericField,
  resolveSelectedField,
  type LabelField,
} from "./labelField.js";
