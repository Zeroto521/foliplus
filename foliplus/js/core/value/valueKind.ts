// core/value/valueKind — the by-value config kind vocabulary.
//
// The by-value style mode is typed one of two ways: the drive property is
// either a number split into ordered classes ("numeric") or a categorical
// label painted with a qualitative scheme ("category"). Every consumer of a
// by-value config — the declaration reader, the persistence reader, the ramp
// builder, the intent guard — tests and writes these two literals on its own.
// This module is the one place that owns the words, so a third kind or a
// renaming cannot drift across the six consumers silently.
//
// "Absent is numeric" is a pervasive convention: a pre-kind record shape (or
// an author who left the override out) reads as the numeric mode. It is
// encoded here as isCategoryKind(kind?) so the convention lives beside the
// vocabulary instead of being re-derived per caller.
//
// This is the VALUE kind (numeric / category), deliberately NOT:
//  - the filter field kind (core/layer/filterFeature.ts FieldKind:
//    "numeric" / "string" / "boolean" — how a filter stores a field), and
//  - the icon source kind (ICON_KIND.GLYPH in core/layer/intent.ts), and
//  - the style mode (STYLE_MODE solid/value/original in core/layer/intent.ts).
// Mixing those vocabularies into one constant is the conflation the import
// boundary and the intent guard both guard against.

/** The by-value config kinds, one word per mode. Absent = NUMERIC. */
const VALUE_KIND = {
  NUMERIC: "numeric",
  CATEGORY: "category",
} as const;
type ValueKind = (typeof VALUE_KIND)[keyof typeof VALUE_KIND];

/** Whether a raw value is one of the by-value config kinds. An unknown kind
 *  (including a third kind a client cannot build) is rejected rather than
 *  misapplied as a numeric ramp — the persistence reader's drop-whole rule. */
const isValueKind = (value: unknown): value is ValueKind =>
  value === VALUE_KIND.NUMERIC || value === VALUE_KIND.CATEGORY;

/** Whether a by-value config's kind selects the categorical mode. Encodes the
 *  absent-is-numeric convention: undefined (or "numeric") reads as the numeric
 *  mode, "category" as the categorical one. A kind outside the vocabulary
 *  reads as numeric too (the caller's isValueKind check drops it first), but
 *  the predicate is total and non-throwing so a live rule can call it without
 *  a separate guard. */
const isCategoryKind = (kind?: ValueKind): boolean => kind === VALUE_KIND.CATEGORY;

export { VALUE_KIND, isCategoryKind, isValueKind };
export type { ValueKind };
