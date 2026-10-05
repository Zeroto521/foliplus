"""Tests for ``script/check/mojibake_check.py`` — UTF-8 replacement-character gate.

The hook reads each staged file as raw bytes and fails when it contains
``EF BF BD`` (the UTF-8 encoding of U+FFFD). That sequence is a
*replacement* marker, not a preserved value: once a stream has round-tripped
through a lossy codec, the original character is gone, so the script only
reports positions — it never attempts to fix.

Coverage target: full branch coverage of ``main()``. Tests cover the
early-exit paths, the byte-search semantics (a single ``EF`` is not a hit,
the three bytes must sit next to each other), multi-hit accounting, missing
files, and the CLI entry point.
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
SCRIPT = REPO_ROOT / "script" / "check" / "mojibake_check.py"
FFFD = b"\xef\xbf\xbd"


_spec = importlib.util.spec_from_file_location("mojibake_check", SCRIPT)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)  # type: ignore[union-attr]


def _run(argv: list[str], *, capsys, monkeypatch) -> int:
    """Invoke ``main()`` with ``argv`` (file paths) as ``sys.argv[1:]``.

    ``main`` indexes ``sys.argv[1:]``, so the argv list it sees must include
    a leading program name. The tests pass only the file paths here.
    """
    monkeypatch.setattr(sys, "argv", ["mojibake_check.py", *argv])
    return mod.main()


class TestEntryGuard:
    def test_no_args_returns_zero(self, capsys, monkeypatch):
        assert _run([], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""


class TestCleanFile:
    def test_ascii_file_returns_zero(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "clean.txt"
        f.write_bytes(b"hello, world\nsecond line\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_unicode_emoji_and_arrow_are_not_mojibake(
        self, tmp_path, capsys, monkeypatch
    ):
        """Legitimate multi-byte UTF-8 characters are not U+FFFD."""
        f = tmp_path / "unicode.txt"
        f.write_bytes("→ arrow\n— em dash\n↔ swap\n中文\n😀\n".encode())
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_empty_file_returns_zero(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "empty.txt"
        f.write_bytes(b"")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_partial_ef_byte_is_not_a_hit(self, tmp_path, capsys, monkeypatch):
        """A stray ``EF`` without the trailing ``BF BD`` is not a replacement."""
        f = tmp_path / "partial.txt"
        f.write_bytes(b"line with \xef alone\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_first_two_of_three_bytes_is_not_a_hit(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "partial2.txt"
        f.write_bytes(b"line with \xef\xbf alone\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_three_bytes_without_eff_prefix_is_not_a_hit(
        self, tmp_path, capsys, monkeypatch
    ):
        f = tmp_path / "partial3.txt"
        f.write_bytes(b"line with \xbf\xbd alone\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestHit:
    def test_single_fffd_returns_one_and_reports_line(
        self, tmp_path, capsys, monkeypatch
    ):
        f = tmp_path / "hit.txt"
        f.write_bytes(b"clean line\nbroken \xef\xbf\xbd line\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert f"{f}:2" in captured.out
        assert "U+FFFD" in captured.err
        assert "1 line(s) contain" in captured.err

    def test_fffd_on_first_line(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "hit_first.txt"
        f.write_bytes(b"\xef\xbf\xbd first\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert f"{f}:1" in captured.out

    def test_line_numbering_matches_split(self, tmp_path, capsys, monkeypatch):
        """Line numbers count from 1 across the file, not from the hit."""
        f = tmp_path / "hit_lines.txt"
        f.write_bytes(b"a\nb\nc\nhit \xef\xbf\xbd\n")
        _run([str(f)], capsys=capsys, monkeypatch=monkeypatch)
        captured = capsys.readouterr()
        assert f"{f}:4" in captured.out

    def test_multiple_lines_each_reported(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "multi.txt"
        f.write_bytes(b"\xef\xbf\xbd one\nline\n\xef\xbf\xbd three\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        # Every line with a hit is reported individually.
        assert f"{f}:1" in captured.out
        assert f"{f}:3" in captured.out
        assert captured.err.count("line(s) contain") == 1

    def test_two_fffd_in_same_line_counts_as_one(self, tmp_path, capsys, monkeypatch):
        """The script is line-oriented: two hits on one line is one failure."""
        f = tmp_path / "twice.txt"
        f.write_bytes(b"a \xef\xbf\xbd b \xef\xbf\xbd c\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert captured.out.count(str(f)) == 1
        assert "1 line(s) contain" in captured.err

    def test_crlf_line_endings_report_correct_line(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "crlf.txt"
        f.write_bytes(b"one\r\ntwo \xef\xbf\xbd\r\n")
        _run([str(f)], capsys=capsys, monkeypatch=monkeypatch)
        captured = capsys.readouterr()
        assert f"{f}:2" in captured.out

    def test_report_prints_line_content(self, tmp_path, capsys, monkeypatch):
        """The report shows the offending line so a reviewer can eyeball it."""
        f = tmp_path / "content.txt"
        f.write_bytes(b"line \xef\xbf\xbd content\n")
        _run([str(f)], capsys=capsys, monkeypatch=monkeypatch)
        captured = capsys.readouterr()
        assert "line " in captured.out
        assert "content" in captured.out

    def test_stderr_summary_points_to_the_wikipedia_article(
        self, tmp_path, capsys, monkeypatch
    ):
        """The stderr summary is the human-facing recovery note."""
        f = tmp_path / "summary.txt"
        f.write_bytes(b"\xef\xbf\xbd\n")
        _run([str(f)], capsys=capsys, monkeypatch=monkeypatch)
        captured = capsys.readouterr()
        assert "U+FFFD" in captured.err
        assert "UTF-8" in captured.err
        assert "no BOM" in captured.err
        assert "wikipedia" in captured.err.lower()


class TestMissingAndMixed:
    def test_missing_file_is_skipped(self, capsys, monkeypatch):
        """A vanished staged file must not crash the hook (see the try/except)."""
        missing = Path.cwd() / "definitely-not-here-abc123.txt"
        assert _run([str(missing)], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_missing_among_hits_is_skipped(self, tmp_path, capsys, monkeypatch):
        """One bad file out of many is enough to fail; the others don't help."""
        good = tmp_path / "good.txt"
        good.write_bytes(b"clean\n")
        bad = tmp_path / "bad.txt"
        bad.write_bytes(b"hit \xef\xbf\xbd\n")
        missing = tmp_path / "gone.txt"
        assert (
            _run(
                [str(good), str(bad), str(missing)],
                capsys=capsys,
                monkeypatch=monkeypatch,
            )
            == 1
        )
        captured = capsys.readouterr()
        # Good file produces no line; bad file does; missing file is silent.
        assert str(good) not in captured.out
        assert str(bad) in captured.out
        assert str(missing) not in captured.out


class TestCLI:
    def test_script_exit_one_on_hit(self, tmp_path):
        """Run the script as a subprocess — that's how pre-commit invokes it."""
        f = tmp_path / "hit.txt"
        f.write_bytes(b"hit \xef\xbf\xbd\n")
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(f)],
            capture_output=True,
            check=False,
        )
        assert proc.returncode == 1
        # The report includes the filename and the decoded line content.
        stdout = proc.stdout.decode("utf-8")
        assert f.name in stdout
        assert "U+FFFD" in proc.stderr.decode("utf-8")

    def test_script_exit_zero_on_clean(self, tmp_path):
        f = tmp_path / "clean.txt"
        f.write_bytes(b"clean\n")
        proc = subprocess.run(
            [sys.executable, str(SCRIPT), str(f)],
            capture_output=True,
            check=False,
        )
        assert proc.returncode == 0
        assert proc.stdout == b""
        assert proc.stderr == b""

    def test_script_with_no_files_returns_zero(self):
        proc = subprocess.run(
            [sys.executable, str(SCRIPT)],
            capture_output=True,
            check=False,
        )
        assert proc.returncode == 0


def test_fffd_constant_is_three_byte_utf8_encoding_of_u_fffd():
    """The script searches for the encoded sequence, not the codepoint."""
    assert mod.FFFD == "\ufffd".encode("utf-8")


class TestCp1252Misread:
    """UTF-8 decoded as Windows-1252 — the em dash / arrow / quote forms.

    ``→`` is ``E2 86 92``. Under CP1252 that decodes byte-by-byte as
    ``â`` + ``†`` + right single quote (U+2019). Same shape for
    em dash (``E2 80 94`` → ``â`` + ``"`` + ``€``) and friends. The
    ``â`` followed by any CP1252 symbol in the ``0x80``-``0x9F`` range
    is a signature; a bare ``â`` outside that class stays unflagged.

    Test literals are written as ``\\uXXXX`` escapes — the mojibake
    signatures they represent would otherwise trigger this very hook
    against the test file itself.
    """

    def test_arrow_misread_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "cp1252.txt"
        f.write_bytes("\u00e2\u2020\u2019 misread\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert f"{f}:1" in captured.out

    def test_em_dash_misread_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "emdash.txt"
        f.write_bytes("\u00e2\u201c\u20ac".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_bare_accented_a_is_not_flagged(self, tmp_path, capsys, monkeypatch):
        """A lone ``â`` outside a CP1252 signature stays clean."""
        f = tmp_path / "accent.txt"
        f.write_bytes("Mme. \u00e2 l\u2019\u00e9preuve\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestLossyByteAfterPunctuation:
    """Real punctuation followed by a bare ``?`` — the ``\u2014?`` shape.

    Some codecs, on hitting a byte they cannot map at the tail of a
    multi-byte sequence, substitute ``?``. The leading em dash / arrow
    / en dash / middle dot / ideographic full stop survives intact and
    sits next to the replacement. Optional whitespace between the anchor
    and ``?`` is allowed.

    (The signature literal appears as a ``\\uXXXX`` escape here to keep
    the file clean of the signature it detects — see the note in
    ``TestCp1252Misread``.)
    """

    def test_em_dash_followed_by_question_mark_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        f = tmp_path / "dashq.txt"
        f.write_bytes("value \u2014? next\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_arrow_space_question_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "arrowq.txt"
        f.write_bytes("step \u2192 ? done\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_em_dash_alone_is_clean(self, tmp_path, capsys, monkeypatch):
        """The dash without a trailing ``?`` stays clean."""
        f = tmp_path / "dash.txt"
        f.write_bytes("one \u2014 two\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestGbkMisread:
    """UTF-8 decoded as GBK/CP936 — U+951F / U+9225 / U+922B family."""

    def test_gbk_replacement_run_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "gbk.txt"
        f.write_bytes("\u951f\u65a4\u62f7\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_gbk_em_dash_misread_is_flagged(self, tmp_path, capsys, monkeypatch):
        """The em-dash ``—`` (UTF-8 ``E2 80 94``) misread as GBK yields
        U+9225 plus a lossy ``?`` for the truncated trailing byte — the
        exact shape a non-UTF-8 round-trip leaves behind. The fixture is
        spelled as an escape so the checker's own test file stays clean."""
        f = tmp_path / "gbk2.txt"
        f.write_bytes("\u9225?\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1


class TestGbkEmDashLetterFamily:
    """GBK misread of em-dash + ASCII letter (Rule 5).

    The UTF-8 em-dash (``E2 80 94``) followed by a letter ``X`` decodes
    as a GBK 2-byte pair ``(0x94, X)``, producing a family of CJK
    characters. U+64AB (source ``\\u2014L``) is one member. The full
    52-character family is generated programmatically in the checker.
    """

    def test_gbk_em_dash_l_family_is_flagged(self, tmp_path, capsys, monkeypatch):
        """The real corruption from ``\\u2014Layer`` -> ``\\u2014\\u64ebayer``."""
        f = tmp_path / "family.txt"
        f.write_bytes("\u64eb\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_gbk_em_dash_f_family_is_flagged(self, tmp_path, capsys, monkeypatch):
        """``\\u2014f`` misread as GBK yields U+6506."""
        f = tmp_path / "family_f.txt"
        f.write_bytes("\u6506\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_gbk_em_dash_lowercase_family_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """``\\u2014a`` misread as GBK yields U+6501."""
        f = tmp_path / "family_a.txt"
        f.write_bytes("\u6501\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1


class TestGbkPairCharDefensive:
    """Defensive branches in ``_gbk_pair_char``.

    All 52 ``(0x94, X)`` pairs where ``X`` is an ASCII letter decode
    cleanly, so the ``except`` branch is unreachable from the family
    generator. Exercise it directly with a byte that is not a valid
    GBK trailing byte — ``0x20`` (space) is the real-world pattern:
    ``—`` followed by a space produces ``94 20``, which GBK rejects.
    """

    def test_invalid_trailing_byte_returns_none(self):
        """``(0x94, 0x20)`` — em-dash + space, invalid GBK pair."""
        assert mod._gbk_pair_char(0x94, 0x20) is None

    def test_all_ascii_letters_decode_cleanly(self):
        """The 52-letter family has no ``UnicodeDecodeError`` or
        multi-char surprises — every member is a single CJK character."""
        import string

        chars = [mod._gbk_pair_char(0x94, ord(x)) for x in string.ascii_letters]
        assert all(c is not None for c in chars)
        assert all(len(c) == 1 for c in chars if c is not None)


class TestEmDashGlued:
    """Em-dash glued to an ASCII letter (Rule 6).

    Glued em-dash is either mojibake residue (the misread ate the space)
    or a formatting error — both need fixing. The ``[A-Za-z0-9)]\\u2014``
    rule skips ``\\n\\u2014`` escape sequences where the em-dash is at
    the start of a logical line.
    """

    def test_em_dash_glued_after_lowercase_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Em-dash followed by lowercase letter."""
        f = tmp_path / "glued_after.txt"
        f.write_bytes("// comment \u2014x is bad\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_em_dash_glued_after_uppercase_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Em-dash followed by uppercase letter."""
        f = tmp_path / "glued_upper.txt"
        f.write_bytes("// LayerControl UI \u2014Layer\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_em_dash_glued_before_is_flagged(self, tmp_path, capsys, monkeypatch):
        """Letter followed by em-dash."""
        f = tmp_path / "glued_before.txt"
        f.write_bytes("// stack\u2014no z-index\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_chinese_em_dash_is_clean(self, tmp_path, capsys, monkeypatch):
        """Chinese text with em-dash (no ASCII letters adjacent)."""
        f = tmp_path / "chinese.txt"
        f.write_bytes("中文\u2014中文\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_en_dash_range_is_clean(self, tmp_path, capsys, monkeypatch):
        """Numeric range with en-dash (U+2013), not em-dash (U+2014)."""
        f = tmp_path / "range.txt"
        f.write_bytes("0\u2013100\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_newline_escape_em_dash_is_clean(self, tmp_path, capsys, monkeypatch):
        """``\\n—`` escape sequence (em-dash at start of logical line)."""
        f = tmp_path / "escape.txt"
        content = 'f.write_bytes("arrow\\n\u2014 em dash")\n'
        f.write_bytes(content.encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_spaced_em_dash_is_clean(self, tmp_path, capsys, monkeypatch):
        """`` — `` (em-dash with spaces on both sides)."""
        f = tmp_path / "spaced.txt"
        f.write_bytes("one \u2014 two\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_quoted_em_dash_opening_is_clean(self, tmp_path, capsys, monkeypatch):
        """Em-dash that opens a quoted or f-string body is not glued.

        The BEFORE class deliberately omits the double-quote so that
        f-string openings like f"— Python must not serialize..." and
        quoted strings like "— a new one crept in" don't trip the rule.
        Adding `"` to BEFORE would re-flag every legitimately quoted
        string that starts with a dash.
        """
        f = tmp_path / "quoted_open.txt"
        f.write_bytes(
            'f.write_bytes("arrow\\n\u2014 em dash")\n'
            'other = "\u2014 a new one crept in"\n'.encode("utf-8")
        )
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestArrowGlued:
    """Arrow glued to ASCII (Rule 6 second half).

    The ASCII arrow ``\u2192`` follows the same spacing convention as
    the em-dash. Missing a space on either side is either mojibake
    residue or a formatting error that should be fixed.
    """

    def test_arrow_glued_after_lowercase_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Letter followed directly by arrow."""
        f = tmp_path / "arrow_after.txt"
        f.write_bytes("// visible\u2192hidden transition\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_arrow_glued_after_digit_is_flagged(self, tmp_path, capsys, monkeypatch):
        """Digit followed directly by arrow."""
        f = tmp_path / "arrow_after_num.txt"
        f.write_bytes("the 4\u21923 rebind case\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_arrow_glued_before_is_flagged(self, tmp_path, capsys, monkeypatch):
        """Arrow followed directly by a letter."""
        f = tmp_path / "arrow_before.txt"
        f.write_bytes("// the list \u2192map linkage\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_spaced_arrow_is_clean(self, tmp_path, capsys, monkeypatch):
        """Arrow with spaces on both sides."""
        f = tmp_path / "arrow_spaced.txt"
        f.write_bytes("the list \u2192 map linkage\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_arrow_with_punctuation_after_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Arrow glued to punctuation after (e.g. period) is flagged."""
        f = tmp_path / "arrow_punct.txt"
        f.write_bytes("remove \u2192add. then wait\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1


class TestEmDashWithPunctuationGlued:
    """Em-dash glued to punctuation on the after side (Rule 6 second half).

    The BEFORE class omits `"` to spare legitimately quoted strings,
    but the AFTER class includes it so broken forms like `"—.` (the
    attr.ts corruption from #601) still trip the rule.
    """

    def test_em_dash_glued_to_period_after_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Em-dash followed by a period (broken attr.ts `"—.` shape)."""
        f = tmp_path / "dash_period.txt"
        f.write_bytes('* "\u2014. The color basemap is included\n'.encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_em_dash_glued_to_quoted_is_clean(self, tmp_path, capsys, monkeypatch):
        """The fixed form `"—".` — quote, em-dash, quote — is clean.

        Neither `"` in the AFTER class nor `"` in the BEFORE class, so
        the em-dash wrapped in quotes is not flagged.
        """
        f = tmp_path / "dash_quoted.txt"
        f.write_bytes('* "—". The color basemap is included\n'.encode())
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_em_dash_glued_to_jsdoc_tag_is_flagged(self, tmp_path, capsys, monkeypatch):
        """Em-dash directly before a `{` (JSDoc inline tag) is flagged.

        ``{`` is in the AFTER class because ``—{@link foo}`` is the same
        spacing shape as ``—.` ` — the em-dash is glued to a following
        token with no space between. The fixed form ``— {@link foo}``
        has the space and stays clean.
        """
        f = tmp_path / "dash_jsdoc.txt"
        f.write_bytes(
            " * \u2014{@link applyUserState} projects it then, unchanged.\n".encode(
                "utf-8"
            )
        )
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_em_dash_before_spaced_jsdoc_tag_is_clean(
        self, tmp_path, capsys, monkeypatch
    ):
        """``— {@link foo}`` (space between em-dash and JSDoc tag) is clean."""
        f = tmp_path / "dash_jsdoc_clean.txt"
        f.write_bytes(
            " * \u2014 {@link applyUserState} projects it then, unchanged.\n".encode(
                "utf-8"
            )
        )
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestSpacingSkipFiles:
    """Files that legitimately carry Rule 6 signatures are skipped.

    ``mojibake_check.py`` (this checker) and ``test_mojibake_check.py``
    contain the rule bodies and their test data — a full scan would
    flag the checker itself. ``CHANGELOG.md`` is historical release
    notes where arrows denote real transformations ("PY→JS", "193KB→110KB")
    that we don't rewrite after the fact.
    """

    def test_gate_file_skips_spacing_rule(self, tmp_path, capsys, monkeypatch):
        """Filename match — write a Rule 6 pattern as `mojibake_check.py`.

        The checker's own rule bodies and test data contain the
        signatures Rule 6 catches, so scanning a file that carries the
        checker's filename must not flag it.
        """
        f = tmp_path / "mojibake_check.py"
        f.write_bytes("// x\u2192y\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_same_content_with_normal_filename_is_flagged(
        self, tmp_path, capsys, monkeypatch
    ):
        """Same bytes, different filename — the spacing rule fires."""
        f = tmp_path / "anything.py"
        f.write_bytes("// x\u2192y\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_changelog_skips_spacing_rule(self, tmp_path, capsys, monkeypatch):
        """Filename match — ``CHANGELOG.md`` skips Rule 6 entirely."""
        f = tmp_path / "CHANGELOG.md"
        f.write_bytes(
            b"- `PY\xe2\x86\x92JS` injection\n"
            b"- `193KB\xe2\x86\x92110KB` bundle reduction\n"
        )
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0


class TestTruncatedUtf8Sequence:
    """A UTF-8 multi-byte lead whose continuation byte was replaced with ``?``.

    A lossy codec that truncates the tail of a multi-byte sequence leaves
    the lead pair (``E2 80`` for em/en dash, ``E2 86`` for arrows) intact
    and substitutes ASCII ``?`` for the final byte. The partial lead then
    decodes without U+FFFD and the text-side regex misses it — only a
    byte-level scan sees the truncated pair. Fixtures are written as raw
    bytes so the signature never appears in the test source.
    """

    def test_truncated_em_dash_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "trunc.txt"
        f.write_bytes(b"page) \xe2\x80?typed\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert f"{f}:1" in captured.out

    def test_truncated_arrow_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "truncarrow.txt"
        f.write_bytes(b"step \xe2\x86? next\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_plain_question_after_ascii_is_clean(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "plain.txt"
        f.write_bytes(b"is this? yes\n")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0

    def test_intact_utf8_em_dash_is_clean(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "intact.txt"
        f.write_bytes("one — two\n".encode())
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0
