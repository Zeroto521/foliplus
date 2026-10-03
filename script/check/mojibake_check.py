#!/usr/bin/env python3
"""Detect UTF-8 replacement characters and mojibake signatures in staged files.

The hook scans every staged text file and reports ``file:line`` locations
when it finds any of six signatures of a lossy non-UTF-8 encoding
round-trip:

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
4. **GBK misread** — UTF-8 decoded as GBK/CP936. Signatures: the
   ``EF BF BD`` decoded as GBK yields U+951F (plus U+65A4 and U+62F7 for
   the follow-up pairs), and ``E2`` decoded as GBK yields U+94A5 /
   U+922B.
5. **Em-dash glued to a lowercase Latin letter** (``— the`` / ``— so``) —
   English style separates an em dash from a following word with a space;
   a missing space in an English comment is a fingerprint of a prior
   UTF-8→GBK→UTF-8 round-trip that dropped the space. Only ASCII-adjacent
   cases are flagged: a CJK character right after the dash stays clean.
6. **Overflow-menu glyph misread** (``\u22efmenu``) — the vertical dots
   U+22EE (``⋮``) that the overflow-menu icon uses were misread as the
   mathematical ellipsis U+22EF (``\u22ef``). A bare ``\u22ef`` is legitimate prose;
   ``\u22efmenu`` is not.

None of these can be auto-fixed — the original character is already gone.
See https://en.wikipedia.org/wiki/Mojibake and
https://en.wikipedia.org/wiki/Replacement_character.

Usage (called by pre-commit, filenames as arguments):
    python script/check/mojibake_check.py file1 file2 ...
"""

from __future__ import annotations

import re
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
MOJIBAKE_RE = re.compile(
    f"â[{re.escape(_CP1252_FOLLOWS)}]"
    f"|[{re.escape(_LOSSY_ANCHORS)}][ \\t]*\\?"
    f"|[\u951f\u65a4\u62f7\u9225\u922b]"
    # Em-dash glued to a lowercase Latin letter: the ``— the`` shape. A CJK
    # character right after the dash stays clean (CJK writing allows no
    # space after em dash), so the character class is restricted to
    # [a-z] only — [a-z] is not matched by CJK ideographs.
    f"|—[a-z]"
    # Overflow-menu glyph misread: the vertical dots U+22EE (``⋮``) were
    # misread as the mathematical ellipsis U+22EF (``\u22ef``) followed by
    # "menu". A bare ``\u22ef`` in prose is legitimate; ``\u22efmenu`` is not.
    f"|\\u22efmenu"
)

_SUMMARY = """\

{failures} line(s) contain U+FFFD replacement characters or mojibake
signatures (CP1252 misread, byte loss after punctuation, GBK misread,
em-dash glued to a word, overflow-menu glyph misread).
The original characters were corrupted by a non-UTF-8 encoding round-trip
and cannot be auto-fixed — restore them from the source and save as UTF-8
(no BOM).
See: https://en.wikipedia.org/wiki/Mojibake
     https://en.wikipedia.org/wiki/Replacement_character
"""


def _find_hits(raw: bytes) -> list[tuple[int, str]]:
    """Return ``(lineno, decoded_line)`` for each line containing a signature.

    Byte-level ``EF BF BD`` (U+FFFD) is checked directly against the raw
    bytes; text-side signatures (CP1252 misread, byte loss after
    punctuation, GBK misread) are matched against the UTF-8 decoding.
    Each line is split and decoded exactly once — the caller prints the
    decoded text returned here rather than re-decoding.
    """
    hits: list[tuple[int, str]] = []
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
        for lineno, text in _find_hits(raw):
            print(f"{filepath}:{lineno}: {text}")
            failures += 1

    if failures:
        print(_SUMMARY.format(failures=failures), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
