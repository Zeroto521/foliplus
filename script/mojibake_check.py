#!/usr/bin/env python3
"""Detect UTF-8 replacement characters and mojibake signatures in staged files.

The hook scans every staged text file and reports ``file:line`` locations
when it finds any of four signatures of a lossy non-UTF-8 encoding
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

None of these can be auto-fixed — the original character is already gone.
See https://en.wikipedia.org/wiki/Mojibake and
https://en.wikipedia.org/wiki/Replacement_character.

Usage (called by pre-commit, filenames as arguments):
    python script/mojibake_check.py file1 file2 ...
"""

from __future__ import annotations

import re
import sys

# UTF-8 encoding of U+FFFD. Kept at byte granularity so a stray ``EF``
# without the trailing ``BF BD`` never reads as a hit.
FFFD = b"\xef\xbf\xbd"

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
    f"|[\u951f\u65a4\u62f7\u94a5\u922b]"
)

_SUMMARY = """\

{failures} line(s) contain U+FFFD replacement characters or mojibake
signatures (CP1252 misread, byte loss after punctuation, GBK misread).
The original characters were corrupted by a non-UTF-8 encoding round-trip
and cannot be auto-fixed — restore them from the source and save as UTF-8
(no BOM).
See: https://en.wikipedia.org/wiki/Mojibake
     https://en.wikipedia.org/wiki/Replacement_character
"""


def _find_hits(raw: bytes) -> list[int]:
    """Return sorted 1-based line numbers where any signature is present."""
    lines = raw.split(b"\n")
    hits: set[int] = set()
    for lineno, line in enumerate(lines, 1):
        if FFFD in line:
            hits.add(lineno)
            continue
        # Decode this line alone — bad bytes here become U+FFFD, which we
        # already caught in the byte scan above; here we only need to see
        # the CP1252 / lossy-byte / GBK signatures in the readable text.
        text = line.decode("utf-8", errors="replace")
        if MOJIBAKE_RE.search(text):
            hits.add(lineno)
    return sorted(hits)


def _decode_line(raw_lines: list[bytes], lineno: int) -> str:
    return raw_lines[lineno - 1].decode("utf-8", errors="replace").rstrip()


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

        lines = raw.split(b"\n")
        for lineno in _find_hits(raw):
            print(f"{filepath}:{lineno}: {_decode_line(lines, lineno)}")
            failures += 1

    if failures:
        print(_SUMMARY.format(failures=failures), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
