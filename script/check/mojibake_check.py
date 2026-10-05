#!/usr/bin/env python3
"""Detect UTF-8 replacement characters and mojibake signatures in staged files.

The hook scans every staged text file and reports ``file:line`` locations
when it finds any of six signatures of a lossy non-UTF-8 encoding
round-trip or a formatting error that should be fixed:

1. **U+FFFD** (``EF BF BD``) — the UTF-8 replacement character itself.
   Detected as a byte sequence, so a stray ``EF`` without the trailing
   ``BF BD`` never reads as a hit.
2. **CP1252 misread** — UTF-8 was decoded as Windows-1252, so the second
   continuation byte (``0x80``-``0x9F``) became the symbol CP1252 maps
   to that code point; the leading ``0xE2`` became U+00E2. Signature:
   U+00E2 followed by one of U+20AC U+201A U+0192 U+201E U+2026 U+2020
   U+2021 U+2030 U+2039 U+2018 U+2019 U+201C U+201D U+2022 U+2013 U+2014
   U+02C6 U+2032 U+2033 U+0152 U+017E (a subset of the ``0x80``-``0x9F``
   range that overlaps common UTF-8 lead bytes).
3. **Byte loss after a real punctuation mark** — an em dash / en dash /
   arrow / middle dot / ideographic full stop followed (with optional
   whitespace) by a bare ``?``. Some codecs substitute ``?`` for a
   trailing byte they cannot map.
4. **GBK misread (single-char family)** — UTF-8 decoded as GBK/CP936.
   Signatures: the ``EF BF BD`` decoded as GBK yields U+951F (plus U+65A4
   and U+62F7 for the follow-up pairs), and ``E2`` decoded as GBK yields
   U+94A5 / U+922B.
5. **GBK misread (em-dash + letter family)** — the UTF-8 em-dash
   (``E2 80 94``) followed by an ASCII letter ``X`` decodes as a GBK
   2-byte pair ``(0x94, X)``, producing a family of CJK characters.
   U+64AB (source ``\\u2014L``) is one member; the full 52-character
   family is generated programmatically so a new misread is caught as
   soon as it appears.
6. **Em-dash or arrow glued to ASCII text** — ``\\u2014x``,
   ``x\\u2014``, ``\\u2192x``, or ``x\\u2192`` where the second
   character is a letter, digit, or common punctuation. Either a
   mojibake residue (the misread ate the space) or a formatting error
   that should be fixed. BEFORE character class is
   ``[A-Za-z0-9)]`` plus ``.,;:!?{``; AFTER character class is
   ``[A-Za-z0-9]`` plus the same punctuation — the two sides are
   asymmetric so parenthesized / quoted shapes like ``(→)``, ``(—)``,
   ``"→"``, ``'—'``, `` `—` `` stay clean while still catching
   letter-glued forms and broken forms like ``"—."`` (period after
   the em-dash) and ``—{@link ...}`` (JSDoc tag glued to the dash).
   The ``[A-Za-z0-9)]\\u2014`` half uses a backslash-lookbehind to
   skip the ``\\n\\u2014`` escape sequence (backslash-n followed by
   em-dash) where the em-dash is at the start of a logical line, not
   adjacent to ``n``. Deliberate exemptions: this file and its tests
   are skipped entirely (they contain the rule bodies and test data
   for the mojibake signatures, so a full scan would flag itself), and
   ``CHANGELOG.md`` lines carrying historical release-note arrow
   notation (``PY\\u2192JS``, ``193KB\\u2192110KB``, ``716\\u2192785``)
   are exempted per line so new CHANGELOG entries still get checked.

None of these can be auto-fixed — the original character is already gone.
See https://en.wikipedia.org/wiki/Mojibake and
https://en.wikipedia.org/wiki/Replacement_character.

Usage (called by pre-commit, filenames as arguments):
    python script/check/mojibake_check.py file1 file2 ...
"""

from __future__ import annotations

import re
import string
import sys

# UTF-8 encoding of U+FFFD. Kept at byte granularity so a stray ``EF``
# without the trailing ``BF BD`` never reads as a hit.
FFFD = b"\xef\xbf\xbd"

# Truncated UTF-8 sequences: a valid 2/3-byte lead (E2 80, E2 81, E2 82,
# E2 84, E2 86, E2 87, E2 88, E2 89, E2 8C, E2 8D, E2 8E, E2 8F, E2 90,
# E2 91, E2 92, E2 93, E2 94, E2 95, E2 96, E2 97, E2 98, E2 99, E2 9A,
# E2 9B, E2 9C, E2 9D, E2 9E, E2 9F) whose continuation byte was replaced
# with ASCII `?` (0x3F) by a lossy codec. The partial lead then decodes
# cleanly-ish (no U+FFFD) and the text regex misses it — only a byte-level
# scan sees the truncated pair. `?` itself is ASCII, so the pattern must
# not fire on a plain question mark after ordinary text.
_TRUNCATED_UTF8_RE = re.compile(rb"[\xe2][\x80-\x9f][\x3f]")

# Characters produced when a UTF-8 continuation byte 0x80-0x9F is decoded
# as Windows-1252. Only the range that overlaps with common UTF-8 lead
# bytes (E2 for em/en dash, arrows, CJK punctuation) is enumerated — a
# bare ``â`` outside this class stays unflagged to avoid false positives.
_CP1252_FOLLOWS = "€‚ƒ„…†‡‰‹‘’‚“”•–—ˆ‹›ŒŽ"

# Real punctuation marks that commonly end a UTF-8 sequence whose trailing
# byte was replaced with ``?``.
_LOSSY_ANCHORS = "\u2013\u2014\u2192\u2190\u00b7\u3002"

# Three text-side signatures. U+FFFD is deliberately excluded — it is the
# byte-level signal (``EF BF BD``) and is caught by the ``FFFD in line``
# scan, so a single stray ``EF`` that ``decode(..., replace)`` turns into
# ``U+FFFD`` does NOT re-enter the text scan and get reported twice.


def _gbk_pair_char(b1: int, b2: int) -> str | None:
    """Decode a GBK 2-byte pair to a single character, or ``None`` if invalid.

    Both ``except`` and the ``len != 1`` guard are defensive — every GBK
    pair either decodes to exactly one character or raises
    ``UnicodeDecodeError``. The guards are kept for future-proofing.
    """
    try:
        s = bytes([b1, b2]).decode("gbk")
        return s if len(s) == 1 else None
    except UnicodeDecodeError:
        return None


# GBK misread of "em-dash + ASCII letter": UTF-8 em-dash (E2 80 94)
# followed by a letter X decodes as GBK pair (0x94, X). U+64AB
# (source `\u2014L`) is one member; generate the full 52-character family
# here so any new misread signature is caught automatically.
_GBK_EMDASH_LETTER_FAMILY = "".join(
    c
    for c in (_gbk_pair_char(0x94, ord(x)) for x in string.ascii_letters)
    if c is not None
)

# Rule 6: em-dash or arrow glued to ASCII text (letter, digit, or
# punctuation on either side). Either a mojibake residue (the misread
# ate the space) or a formatting error — both need fixing.
#
# The BEFORE class deliberately omits the double-quote character: an
# em-dash that legitimately opens a quoted or f-string body (f"\u2014 Python
# must not serialize...", "\u2014 a new one crept in") has no letter or
# punctuation directly before the em-dash, and adding `"` to BEFORE
# would re-flag those. Punctuation IS included so broken forms like
# "—." (attr.ts comment from #601) still trip the rule.
#
# BEFORE and AFTER classes are asymmetric:
#   BEFORE = [A-Za-z0-9)] + PUNCT — the extra `)` catches `foo—` shapes
#     like "the list →map", "text —end", "value −" (arrow/em-dash at
#     the END of a bracketed phrase). `"` is deliberately absent here
#     so `"— ...` and `f"— ...` (a dash opening a quoted string) stay
#     clean.
#   AFTER  = [A-Za-z0-9] + PUNCT — no `)`, no `'`, no backtick, no
#     `"`. This spares the "wrapped in brackets/quotes" shapes:
#     `(→)` `(—)` `'—'` `` `—` `` `"—"` all read as a token flanked by
#     matching delimiters, not as mojibake residue. If a future case
#     needs `)` here, it must be a new regex.
# PUNCT is shared between BEFORE and AFTER — `. , ; : ! ? {` — so
# punctuation that immediately follows the dash/arrow is treated the
# same as a letter or digit on that side.
#
# Files that legitimately contain the signatures this rule catches are
# skipped entirely — the checker itself and its tests naturally carry
# the rule bodies and their test data. CHANGELOG.md is NOT skipped
# wholesale: historical release notes use a couple of shorthand arrow
# shapes (``PY→JS``, ``193KB→110KB``, ``716→785``) that are meaningful
# and shouldn't be rewritten, but new CHANGELOG entries must still be
# checked. The exemption is line-level and pattern-based (see
# _CHANGELOG_HISTORICAL_ARROW_RE in _find_hits).
_SPACING_SKIP_FILES = {
    "mojibake_check.py",
    "test_mojibake_check.py",
}
# Characters directly BEFORE an em-dash or arrow — glue-shape on the
# left. The `)` catches `foo—`/`list→` closing brackets that lost a
# space; `"` is deliberately absent so `"— a new one crept in` (a
# quoted string starting with a dash) stays clean.
_EM_BEFORE_CHARS = "A-Za-z0-9)"
# Punctuation that can glue to either side of an em-dash or arrow —
# the AFTER shape `"—.` (attr.ts corruption from #601) is caught via
# the trailing `.`, and the BEFORE shape `end.→` trips on the leading
# `.`. `{` catches JSDoc inline tags like `—{@link foo}` / `→{@link}`
# that lost a space. `"` `'` backtick and `)` are absent — those are
# used as paired delimiters (see the class-comment block above).
_GLUE_PUNCT = ".,;:!?{"

# AFTER character set for the right side of an em-dash / arrow — no
# `)`, no quotes, no backticks, so wrapped shapes like `(→)` / `"—"`
# stay clean. Shares the punctuation set with the BEFORE side.
_EM_AFTER_CHARS = "A-Za-z0-9"

_EMDASH_AFTER_RE = re.compile(r"\u2014[" + _EM_AFTER_CHARS + _GLUE_PUNCT + "]")
_EMDASH_BEFORE_RE = re.compile(r"(?<!\\)[" + _EM_BEFORE_CHARS + _GLUE_PUNCT + "]\u2014")
_ARROW_AFTER_RE = re.compile(r"\u2192[" + _EM_AFTER_CHARS + _GLUE_PUNCT + "]")
_ARROW_BEFORE_RE = re.compile(r"(?<!\\)[" + _EM_BEFORE_CHARS + _GLUE_PUNCT + "]\u2192")

# CHANGELOG.md lines that use unspaced arrows as historical shorthand —
# release notes where a metric changed between versions. Only lines
# matching one of these are exempted from Rule 6; new entries still
# get checked. Patterns are intentionally narrow so accidental new
# arrows in the CHANGELOG are flagged.
#   \b[A-Z]+→[A-Z]+\b — PY→JS style migration notation (uppercase
#     word, arrow, uppercase word; the \b anchors stop partial matches
#     like `PYX→J` inside a longer identifier).
#   \d+(?:\D*→\D*|→)\d+ — numeric deltas: `716→785`, `4→3`, and also
#     `193KB→110KB` (units like KB, tests, etc. are permitted on either
#     side because they're non-digit, non-arrow). Requires a digit on
#     both sides so prose like `foo→bar` is not exempted.
_CHANGELOG_HISTORICAL_ARROW_RE = re.compile(
    r"\b[A-Z]+\u2192[A-Z]+\b"
    r"|\d+(?:\D*\u2192\D*|\u2192)\d+"
)

MOJIBAKE_RE = re.compile(
    f"â[{re.escape(_CP1252_FOLLOWS)}]"
    f"|[{re.escape(_LOSSY_ANCHORS)}][ \\t]*\\?"
    f"|[\u951f\u65a4\u62f7\u9225\u922b]"
    f"|[{re.escape(_GBK_EMDASH_LETTER_FAMILY)}]"
)

_SUMMARY = """\

{failures} line(s) contain U+FFFD replacement characters, mojibake
signatures (CP1252 misread, byte loss after punctuation, GBK misread
including the em-dash+letter family), or em-dash glued to ASCII letters
(mojibake residue or formatting error — both need fixing).
The original characters were corrupted by a non-UTF-8 encoding round-trip
and cannot be auto-fixed — restore them from the source and save as UTF-8
(no BOM).
See: https://en.wikipedia.org/wiki/Mojibake
     https://en.wikipedia.org/wiki/Replacement_character
"""


def _has_spacing_violation(text: str) -> bool:
    """Return ``True`` if ``text`` has a Rule 6 spacing violation.

    Em-dash or arrow glued to a letter, digit, or common punctuation.
    BEFORE and AFTER character classes are asymmetric (see the class
    comment above the regex definitions): BEFORE includes ``)`` so
    ``foo—`` / ``list→`` trip the rule, but AFTER omits ``)`` so
    parenthesized shapes like ``(→)`` / ``(—)`` read as token+delim and
    are spared. Double-quote is absent from both sides so quoted
    strings that start with or end in a dash stay clean. The BEFORE
    pattern for em-dash uses a backslash-lookbehind so the
    ``\\n\\u2014`` escape sequence (em-dash at the start of a logical
    line) is skipped.
    """
    return bool(
        _EMDASH_AFTER_RE.search(text)
        or _EMDASH_BEFORE_RE.search(text)
        or _ARROW_AFTER_RE.search(text)
        or _ARROW_BEFORE_RE.search(text)
    )


def _find_hits(raw: bytes, filepath: str = "") -> list[tuple[int, str]]:
    """Return ``(lineno, decoded_line)`` for each line containing a signature.

    Byte-level ``EF BF BD`` (U+FFFD) is checked directly against the raw
    bytes; text-side signatures (CP1252 misread, byte loss after
    punctuation, GBK misread, spacing violations) are matched against the
    UTF-8 decoding. Each line is split and decoded exactly once — the
    caller prints the decoded text returned here rather than re-decoding.

    Files whose basename is in ``_SPACING_SKIP_FILES`` (this checker and
    its tests) bypass Rule 6 entirely. ``CHANGELOG.md`` is not skipped
    wholesale — instead, individual lines carrying the historical
    release-note arrow patterns (``PY→JS``, ``193KB→110KB``,
    ``716→785``) are exempted on a per-line basis so new
    CHANGELOG entries still get checked.
    """
    hits: list[tuple[int, str]] = []
    filepath_name = filepath.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    skip_spacing = filepath_name in _SPACING_SKIP_FILES
    is_changelog = filepath_name == "CHANGELOG.md"
    for lineno, line in enumerate(raw.split(b"\n"), 1):
        if FFFD in line:
            hits.append((lineno, line.decode("utf-8", errors="replace").rstrip()))
            continue
        # Truncated UTF-8 sequence: a valid 2/3-byte lead (E2 80 / E2 82 AC
        # etc.) whose trailing byte was replaced with ASCII `?` (0x3F) — the
        # common corruption shape for em/en dashes, arrows and curly quotes.
        # It decodes without U+FFFD and the text regex misses it (the
        # character is incomplete), so it needs the byte-level scan.
        if _TRUNCATED_UTF8_RE.search(line):
            hits.append((lineno, line.decode("utf-8", errors="replace").rstrip()))
            continue
        text = line.decode("utf-8", errors="replace").rstrip()
        if MOJIBAKE_RE.search(text):
            hits.append((lineno, text))
            continue
        if skip_spacing:
            continue
        if is_changelog and _CHANGELOG_HISTORICAL_ARROW_RE.search(text):
            continue
        if _has_spacing_violation(text):
            hits.append((lineno, text))
    return hits


def main() -> int:
    if len(sys.argv) < 2:
        return 0

    failures = 0
    for filepath in sys.argv[1:]:
        try:
            with open(filepath, "rb") as f:
                raw = f.read()
        except OSError:
            continue
        for lineno, text in _find_hits(raw, filepath=filepath):
            print(f"{filepath}:{lineno}: {text}")
            failures += 1

    if failures:
        print(_SUMMARY.format(failures=failures), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
