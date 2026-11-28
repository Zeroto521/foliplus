// control/LayerControl/declaredTrim — the one trim every declared string value uses.

/** The whitespace a declared string value is trimmed of, as explicit code
 *  points. This is the UNION of the two hosts' whitespace sets, not either
 *  host's default: Python's str.isspace() includes U+001C-U+001F / U+0085 that
 *  JavaScript keeps, JavaScript's WhiteSpace/LineTerminator set includes U+FEFF
 *  (a BOM pasted from a CSV) that Python keeps, and an author pasting from rich
 *  text or CJK input brings U+2000-U+200A, U+2028/U+2029, U+202F, U+205F or
 *  U+3000. Trimming the union means one declaration is accepted identically on
 *  both stacks. KEEP IN STEP with DECLARED_TRIM_CODEPOINTS in
 *  foliplus/_declaration/paint.py - the cross-stack guard
 *  (test/python/guard/test_face_vocabulary.py) compares both literals and
 *  asserts every hex reader routes through {@link trimDeclaredString} instead
 *  of a host trim. */
const DECLARED_TRIM_CODEPOINTS: readonly number[] = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680,
  0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009,
  0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
];
const DECLARED_TRIM_CLASS = DECLARED_TRIM_CODEPOINTS.map(
  codepoint => `\\u{${codepoint.toString(16)}}`,
).join("");
const DECLARED_TRIM_RE = new RegExp(
  `^[${DECLARED_TRIM_CLASS}]+|[${DECLARED_TRIM_CLASS}]+$`,
  "gu",
);

/** Trim a declared string value of the shared whitespace set only. Every
 *  declared-string reader that accepts a padded spelling (the hex readers
 *  border / fill / icon / marker_color, the glyph reader) uses this; a reader
 *  must never call String.prototype.trim() itself, because the host default
 *  disagrees with Python's str.strip() on U+001C-U+001F / U+0085 and U+FEFF. */
const trimDeclaredString = (value: string): string =>
  value.replace(DECLARED_TRIM_RE, "");

export { trimDeclaredString };
