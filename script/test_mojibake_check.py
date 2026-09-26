"""Tests for ``script/mojibake_check.py`` — UTF-8 replacement-character gate.

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
REPO_ROOT = HERE.parent
SCRIPT = HERE / "mojibake_check.py"
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

    (Escaped form in this docstring to keep the file clean of the
    signature it detects.)

    Some codecs, on hitting a byte they cannot map at the tail of a
    multi-byte sequence, substitute ``?``. The leading em dash / arrow
    / en dash / middle dot / ideographic full stop survives intact and
    sits next to the replacement. Optional whitespace between the anchor
    and ``?`` is allowed.

    Escaped form — see the note in ``TestCp1252Misread``.
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
    """UTF-8 decoded as GBK/CP936 — U+951F / U+94A5 / U+922B family."""

    def test_gbk_replacement_run_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "gbk.txt"
        f.write_bytes("\u951f\u65a4\u62f7\n".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1

    def test_gbk_citation_shape_is_flagged(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "gbk2.txt"
        f.write_bytes("\u94a5\u00eb\u2019".encode("utf-8"))
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
