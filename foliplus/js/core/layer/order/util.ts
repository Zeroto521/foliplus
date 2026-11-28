// core/layer/order/util — shared predicates for the order document model.

/** True for a non-empty string. */
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

export { isNonEmptyString };
