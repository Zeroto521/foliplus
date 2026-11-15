// core/overlay — hint class vocabulary.
//
// Both tokens are written/read inside hint.ts (a scanner-blind module), so they
// live in a *ClassName.ts owner file that class-owner --include-core can see.
const HINT_CLASS = {
  /** The hint shell (the `.foliplus-hint` root element). */
  SHELL: "foliplus-hint",
  /** The icon span inside the hint (the only HTML a hint may carry). */
  ICON: "foliplus-hint-icon",
} as const;

export { HINT_CLASS };
