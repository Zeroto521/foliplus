// core/value/index — the value-domain barrel.
//
// The five value modules (classify, field, palette, ramp, rampForm) form a
// self-contained subgraph: ramp pulls classify/field/palette, rampForm pulls
// classify, and nothing outside core/value/ is reached. This barrel forwards
// their public names unchanged so a consumer may import #core/value/index.js
// instead of five deep paths. The individual modules stay the source of truth;
// this file adds no names of its own.
export {
  CLASS_COUNT,
  CLASS_COUNT_VALUES,
  ClassifierDependencyError,
  ClassifyMethodError,
  METHOD,
  METHOD_ORDER,
  computeBreaks,
  isClassifyMethod,
} from "./classify.js";
export type { ClassifyMethod } from "./classify.js";
export {
  categoricalPropertiesKeys,
  categoryDomain,
  inferFieldKind,
  isCategoryValue,
  isNumericValue,
  numericPropertiesKeys,
  resolveField,
} from "./field.js";
export {
  CATEGORY_SCHEMES,
  DEFAULT_SCHEMES,
  PaletteConfigError,
  SCHEME_FALLBACK_COLOR,
  getCategoryColors,
  getColorScale,
  safeColorScale,
} from "./palette.js";
export {
  buildCategoryRamp,
  buildRamp,
  categoryLabel,
  colorFor,
  isFiniteNumber,
  leafPropertyValue,
} from "./ramp.js";
export { buildClassesRow, buildFieldRow, buildSchemeRow } from "./rampForm.js";
export { VALUE_KIND, isValueKind, isCategoryKind } from "./valueKind.js";
export type { ValueKind } from "./valueKind.js";
