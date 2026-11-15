// platform/iconClassName — icon class vocabulary for template-embedded tokens.
//
// Both tokens are embedded in SVG/div template strings inside platform/icon.ts
// (a scanner-blind module), so they live in a *ClassName.ts owner file that
// class-owner can see.
const ICON_CLASS = {
  /** The loading spinner's animation/rotation class. */
  SPIN: "foliplus-spin",
  /** The measure pin's shell (the `.foliplus-pin` div). */
  PIN: "foliplus-pin",
} as const;

export { ICON_CLASS };
