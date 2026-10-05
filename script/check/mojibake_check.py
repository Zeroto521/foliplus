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
   character is a letter, digit, or common punctuation (``. , ; : ! ? '
   ` )``). Either a mojibake residue (the misread ate the space) or a
   formatting error that should be fixed. The
   ``[A-Za-z0-9)]\\u2014`` half uses a backslash-lookbehind to skip the
   ``\\n\\u2014`` escape sequence (backslash-n followed by em-dash)
   where the em-dash is at the start of a logical line, not adjacent to
   ``n``. Deliberate exemptions: this file and its tests are skipped
   entirely (they contain the rule bodies and test data for the
   mojibake signatures, so a full scan would flag itself), and
   ``CHANGELOG.md`` lines carrying historical size-delta notation
   (``193KB\\u2192110KB``, ``PY\\u2192JS``) are skipped per-line —
   those are release facts, not prose.

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
# Files that legitimately contain the signatures this rule catches are
# skipped entirely — the checker itself and its tests naturally carry
# the rule bodies and their test data, and CHANGELOG.md is historical
# release notes where arrows denote real transformations ("PY→JS
# injection", "*.js → *.ts", "193KB→110KB", "716→785 tests") that we
# don't rewrite after the fact.
_SPACING_SKIP_FILES = {
    "mojibake_check.py",
    "test_mojibake_check.py",
    "CHANGELOG.md",
}
# Letter/digit/paren characters used by the BEFORE patterns — an em-dash
# or arrow at the end of a word, number, or `)` is the mojibake signature.
# Deliberately omits `"` to spare legitimately quoted strings on the
# BEFORE side (see _has_spacing_violation's docstring).
_EM_BEFORE_CHARS = "A-Za-z0-9)"
# Punctuation that is glued to an em-dash/arrow on the AFTER side —
# the corruption shape `"—.` (attr.ts comment from #601) is caught
# because `.` is here, while the fixed `"—".` stays clean because `"`
# is deliberately absent from this class.
_EM_AFTER_PUNCT = ".,;:!?'`)"

_EMDASH_AFTER_RE = re.compile(r"\u2014[" + _EM_BEFORE_CHARS + _EM_AFTER_PUNCT + "]")
_EMDASH_BEFORE_RE = re.compile(
    r"(?<!\\)[" + _EM_BEFORE_CHARS + _EM_AFTER_PUNCT + "]\u2014"
)
_ARROW_AFTER_RE = re.compile(r"\u2192[" + _EM_BEFORE_CHARS + _EM_AFTER_PUNCT + "]")
_ARROW_BEFORE_RE = re.compile(r"(?<!\\)[" + _EM_BEFORE_CHARS + "]\u2192")

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
    The BEFORE pattern for em-dash uses a backslash-lookbehind so the
    ``\n—`` escape sequence (em-dash at the start of a logical line) is
    skipped. Double-quote is deliberately absent from the BEFORE class
    to avoid flagging em-dash that opens a quoted or f-string body.
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

    ``skip_spacing`` bypasses Rule 6 for files that legitimately contain
    its signatures (this checker itself, its tests, historical CHANGELOG
    size-delta lines).
    """
    hits: list[tuple[int, str]] = []
    filepath_name = filepath.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
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
        if filepath_name in _SPACING_SKIP_FILES:
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
