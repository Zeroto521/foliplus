"""Tests for ``script/style_check.py`` — the three code-style rules.

The script is a check-only gate: it reports ``file:line: message`` and exits 1
when any rule fires. It cannot auto-fix — the fix is a refactor in the editor.

Three rules are checked:

  1. one value export block at file end, optionally followed by a single
     ``export type { ... }`` block; inline ``type X`` in a value export must be
     split; re-exports are barrel-only;
  2. singular file names (``pelias``, ``focus``, ``canvas`` are whitelisted);
  3. American spelling in identifiers and string literals — comments are
     exempt because they carry English prose.

The two ``strip_*`` helpers are the load-bearing part: rule 1 needs strings
*blanled* so ``// export { }`` and ``"{"`` cannot fake a brace, while rule 3
needs strings *kept* so a British word in a user-facing string is still seen.
Rule 3 additionally needs a line-spanning block-comment state machine: a
per-line stripper treats each continuation line of a ``/* ... */`` block as
plain code, which is how English prose would otherwise be reported as a
spelling violation.

Coverage target: full branch coverage of every helper plus the CLI entry
point. ``check_export_blocks`` / ``check_spelling`` are called with line
lists directly so they do not touch the filesystem; ``check_file`` and
``main`` use ``tmp_path`` files because they open paths.
"""

from __future__ import annotations

import runpy
import subprocess
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
SCRIPT = HERE / "style_check.py"


class _ModuleView:
    """Attribute access over runpy globals for concise test calls."""

    def __init__(self, namespace: dict):
        self._ns = namespace

    def __getattr__(self, name: str):
        try:
            return self._ns[name]
        except KeyError as exc:
            raise AttributeError(name) from exc

    def __getitem__(self, name: str):
        return self._ns[name]


mod = _ModuleView(runpy.run_path(str(SCRIPT)))


def _run(argv: list[str], *, capsys, monkeypatch) -> int:
    """Invoke ``main()`` with ``argv`` as ``sys.argv[1:]``.

    ``main`` indexes ``sys.argv[1:]``, so the list it sees must start with a
    program name. The tests pass only the file paths here.
    """
    monkeypatch.setattr(sys, "argv", ["style_check.py", *argv])
    return mod.main()


class TestStripCommentsAndStrings:
    """Rule 1's helper: comments and string contents become spaces.

    It is only used for brace/export matching, so strings may be blanked —
    the point is that ``export {`` inside a comment or a string cannot be
    mistaken for a real export block.
    """

    def test_line_comment_is_truncated(self):
        assert mod.strip_comments_and_strings("a // export { x }") == "a "

    def test_line_comment_at_start(self):
        assert mod.strip_comments_and_strings("// export { x }") == ""

    def test_double_quoted_string_is_blanked(self):
        assert mod.strip_comments_and_strings('export { "a" }') == "export {     }"

    def test_single_quoted_string_is_blanked(self):
        assert mod.strip_comments_and_strings("export { 'a' }") == "export {     }"

    def test_template_string_is_blanked(self):
        assert mod.strip_comments_and_strings("export { `a` }") == "export {     }"

    def test_escaped_quote_inside_string(self):
        """A backslash inside a string must not terminate the string."""
        assert mod.strip_comments_and_strings('export { "a\\"b" }') == "export {      }"

    def test_escaped_backslash_at_string_end(self):
        """``"a\\"`` — the escape swallows the closing quote."""
        assert mod.strip_comments_and_strings('export { "a\\" }') == "export {     "

    def test_unterminated_string_is_blanked_to_eol(self):
        assert mod.strip_comments_and_strings('export { "a }') == "export {     "

    def test_multiple_strings_and_comment(self):
        out = mod.strip_comments_and_strings("a \"x\" b'y' c `z` // tail")
        assert out == "a     b    c     "

    def test_empty_string_is_clean(self):
        assert mod.strip_comments_and_strings("") == ""

    def test_slash_alone_is_kept(self):
        assert mod.strip_comments_and_strings("a / b") == "a / b"

    def test_single_slash_before_end_is_kept(self):
        assert mod.strip_comments_and_strings("a /") == "a /"


class TestStripCommentsLine:
    """Rule 3's helper: comments go, strings stay, block state carries over.

    Returns ``(code, in_block_after_line)``. Strings are copied verbatim so a
    British word in a user-facing string is still checked; comments are dropped
    because they hold English prose.
    """

    def test_line_comment_is_truncated(self):
        out, in_block = mod.strip_comments_line("a // colour", False)
        assert out == "a "
        assert in_block is False

    def test_block_comment_open_closes_state(self):
        out, in_block = mod.strip_comments_line("a /* colour */ b", False)
        assert out == "a  b"
        assert in_block is False

    def test_block_comment_open_carries_across_lines(self):
        """The middle line of a multi-line ``/* */`` is dropped entirely."""
        out, in_block = mod.strip_comments_line("/* colour", False)
        assert out == ""
        assert in_block is True
        out, in_block = mod.strip_comments_line("colour still inside", in_block)
        assert out == ""
        assert in_block is True
        out, in_block = mod.strip_comments_line("colour */", in_block)
        assert out == ""
        assert in_block is False

    def test_text_after_closing_block_survives(self):
        out, in_block = mod.strip_comments_line("/* c */ colour", False)
        assert out == " colour"
        assert in_block is False

    def test_open_with_text_after_is_carried(self):
        out, in_block = mod.strip_comments_line("/* open colour /* inner", False)
        assert out == ""
        assert in_block is True

    def test_double_star_without_slash_does_not_close(self):
        out, in_block = mod.strip_comments_line("colour ** colour", True)
        assert out == ""
        assert in_block is True

    def test_star_only_does_not_close(self):
        out, in_block = mod.strip_comments_line("colour *", True)
        assert out == ""
        assert in_block is True

    def test_closing_at_last_two_chars(self):
        out, in_block = mod.strip_comments_line("colour */", True)
        assert out == ""
        assert in_block is False

    def test_double_star_at_end_without_slash_stays_open(self):
        out, in_block = mod.strip_comments_line("colour **", True)
        assert out == ""
        assert in_block is True

    def test_string_is_kept_verbatim(self):
        out, in_block = mod.strip_comments_line('const x = "colour"', False)
        assert out == 'const x = "colour"'
        assert in_block is False

    def test_slash_slash_inside_string_is_not_a_comment(self):
        out, in_block = mod.strip_comments_line('export "a // b" colour', False)
        assert out == 'export "a // b" colour'
        assert in_block is False

    def test_slash_star_inside_string_is_not_a_comment(self):
        out, in_block = mod.strip_comments_line('export "a /* b" colour', False)
        assert out == 'export "a /* b" colour'
        assert in_block is False

    def test_escaped_quote_inside_string(self):
        out, in_block = mod.strip_comments_line('export "a\\"b" colour', False)
        assert out == 'export "a\\"b" colour'
        assert in_block is False

    def test_escaped_backslash_at_string_end(self):
        """The escape swallows the closing quote, so the string runs to EOL."""
        out, in_block = mod.strip_comments_line('export "a\\" colour', False)
        assert out == 'export "a\\" colour'
        assert in_block is False

    def test_escaped_char_is_copied_two_chars_at_a_time(self):
        """``\\n`` inside a string is copied verbatim as two characters."""
        out, in_block = mod.strip_comments_line(r"export \"a\nb\" colour", False)
        assert out == r"export \"a\nb\" colour"
        assert in_block is False

    def test_unterminated_string_closes_state(self):
        out, in_block = mod.strip_comments_line('export "colour', False)
        assert out == 'export "colour'
        assert in_block is False

    def test_single_quote_string_is_kept(self):
        out, in_block = mod.strip_comments_line("export 'colour'", False)
        assert out == "export 'colour'"
        assert in_block is False

    def test_template_string_is_kept(self):
        out, in_block = mod.strip_comments_line("export `colour`", False)
        assert out == "export `colour`"
        assert in_block is False

    def test_block_comment_open_at_end_of_line(self):
        """``/*`` as the last two characters opens state with nothing after."""
        out, in_block = mod.strip_comments_line("a /*", False)
        assert out == "a "
        assert in_block is True

    def test_single_slash_at_end_is_kept(self):
        out, in_block = mod.strip_comments_line("a /", False)
        assert out == "a /"
        assert in_block is False

    def test_slash_slash_inside_block_is_ignored(self):
        """Inside a block comment, ``//`` is prose, not a line comment."""
        out, in_block = mod.strip_comments_line("colour // colour", True)
        assert out == ""
        assert in_block is True

    def test_slash_star_inside_block_is_ignored(self):
        """A nested ``/*`` does not extend the comment."""
        out, in_block = mod.strip_comments_line("colour /* colour", True)
        assert out == ""
        assert in_block is True

    def test_empty_line_outside_block(self):
        out, in_block = mod.strip_comments_line("", False)
        assert out == ""
        assert in_block is False

    def test_empty_line_inside_block(self):
        out, in_block = mod.strip_comments_line("", True)
        assert out == ""
        assert in_block is True


class TestCheckSpelling:
    """Rule 3: British spellings in identifiers and string literals."""

    def test_clean_lines_have_no_violations(self):
        assert mod.check_spelling(["const color = 'red'\n"]) == []

    def test_british_identifier_is_reported(self):
        v = mod.check_spelling(["const colour = 'red'\n"])
        assert len(v) == 1
        assert v[0][0] == 1
        assert "British spelling `colour`" in v[0][1]
        assert "use `color`" in v[0][1]

    def test_british_word_in_string_is_reported(self):
        v = mod.check_spelling(['const msg = "pick a colour"\n'])
        assert len(v) == 1
        assert v[0][0] == 1

    def test_british_word_in_line_comment_is_exempt(self):
        """Comments carry English prose — they must stay unflagged."""
        assert mod.check_spelling(["// pick a colour\n"]) == []

    def test_british_word_in_multiline_block_comment_is_exempt(self):
        """The per-line fallback that motivated the state machine."""
        lines = ["/* pick a", "colour", "for the chart */\n"]
        assert mod.check_spelling(lines) == []

    def test_british_word_after_closing_block_is_reported(self):
        lines = ["/* prose */ const colour = 1\n"]
        v = mod.check_spelling(lines)
        assert len(v) == 1
        assert v[0][0] == 1

    def test_line_numbering_counts_from_one(self):
        v = mod.check_spelling(["clean\n", "clean\n", "const colour = 1\n"])
        assert len(v) == 1
        assert v[0][0] == 3

    def test_multiple_words_on_one_line_each_reported(self):
        v = mod.check_spelling(["const colour = neighbour\n"])
        assert len(v) == 2
        assert "colour" in v[0][1]
        assert "neighbour" in v[1][1]

    def test_case_insensitive_match(self):
        v = mod.check_spelling(["const Colour = 1\n"])
        assert len(v) == 1
        assert "`Colour`" in v[0][1]

    def test_all_caps_match_is_reported(self):
        v = mod.check_spelling(["const COLOUR = 1\n"])
        assert len(v) == 1
        assert "use `color`" in v[0][1]

    def test_word_guarded_by_underscore_is_not_reported(self):
        """``colour_foo`` is one identifier — no boundary at ``_``."""
        assert mod.check_spelling(["const colour_foo = 1\n"]) == []

    def test_word_guarded_by_digit_is_not_reported(self):
        assert mod.check_spelling(["const colour2 = 1\n"]) == []

    def test_word_inside_camel_case_is_not_reported(self):
        assert mod.check_spelling(["const myColour = 1\n"]) == []

    def test_word_prefixing_longer_identifier_is_not_reported(self):
        assert mod.check_spelling(["const colourValue = 1\n"]) == []

    def test_dollar_guard_blocks_match(self):
        assert mod.check_spelling(["const colour$ = 1\n"]) == []

    def test_longest_match_wins_over_prefix(self):
        """``colours`` must map to ``colors``, not to ``colour`` + leftover ``s``."""
        v = mod.check_spelling(["const colours = 1\n"])
        assert len(v) == 1
        assert "`colours`" in v[0][1]
        assert "use `colors`" in v[0][1]

    @pytest.mark.parametrize(
        ("word", "fix"),
        [
            ("normalise", "normalize"),
            ("normalised", "normalized"),
            ("normalises", "normalizes"),
            ("normalising", "normalizing"),
            ("behaviour", "behavior"),
            ("behaviours", "behaviors"),
            ("centred", "centered"),
            ("centring", "centering"),
            ("honoured", "honored"),
            ("honouring", "honoring"),
            ("recognise", "recognize"),
            ("recognised", "recognized"),
            ("recognises", "recognizes"),
            ("neighbour", "neighbor"),
            ("neighbours", "neighbors"),
            ("recolour", "recolor"),
            ("recoloured", "recolored"),
            ("colouring", "coloring"),
            ("colourful", "colorful"),
        ],
    )
    def test_each_dictionary_entry_resolves(self, word: str, fix: str):
        v = mod.check_spelling([f"const x = '{word}'\n"])
        assert len(v) == 1
        assert f"use `{fix}`" in v[0][1]

    def test_american_spelling_is_clean(self):
        assert mod.check_spelling(["const color = normalize(c, 'centered')\n"]) == []

    def test_word_in_template_string_is_reported(self):
        v = mod.check_spelling(["const s = `pick a colour`\n"])
        assert len(v) == 1
        assert v[0][0] == 1

    def test_comment_after_string_is_still_exempt(self):
        """String content is checked; the trailing comment is not."""
        v = mod.check_spelling(['const s = "colour" // colour\n'])
        assert len(v) == 1
        assert "colour" in v[0][1]

    def test_escaped_slash_in_string_does_not_open_comment(self):
        """``"a\\"`` swallows the quote, so the rest stays string content."""
        v = mod.check_spelling(['const s = "a\\" colour\n'])
        assert len(v) == 1


class TestCheckExportBlocks:
    """Rule 1: one value export block, optional single type block."""

    def test_barrel_file_is_exempt(self):
        path = "index.ts"
        lines = [
            "export * from './a.js'\n",
            "export { b } from './b.js'\n",
            "export { c, type D } from './c.js'\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_type_file_is_exempt(self):
        path = "type.ts"
        lines = [
            "export { type A, type B } from './a.js'\n",
            "export { type C, type D } from './b.js'\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_multiple_type_files_are_excluded(self):
        path = "types.ts"
        lines = [
            "export { type A, type B } from './a.js'\n",
            "export { type C, type D } from './b.js'\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_single_value_export_block_is_clean(self):
        path = "a.ts"
        lines = [
            "const x = 1\n",
            "const y = 2\n",
            "export { x, y }\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_single_value_then_single_type_block_is_clean(self):
        path = "a.ts"
        lines = [
            "const x = 1\n",
            "export { x }\n",
            "export type { A }\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_inline_type_in_value_export_is_reported(self):
        path = "a.ts"
        lines = ["export { x, type B, y }\n"]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "inline `type X`" in v[0][1]

    def test_multiple_value_blocks_are_reported_at_first_line(self):
        path = "a.ts"
        lines = [
            "export { x }\n",
            "export { y }\n",
            "export { z }\n",
        ]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "3 value export blocks" in v[0][1]

    def test_multiple_type_blocks_are_reported_at_first_line(self):
        path = "a.ts"
        lines = [
            "export type { A }\n",
            "export type { B }\n",
            "export type { C }\n",
        ]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "3 type export blocks" in v[0][1]

    def test_star_export_in_non_barrel_is_reported(self):
        path = "a.ts"
        lines = ["export * from './b.js'\n"]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "export * from" in v[0][1]

    def test_value_reexport_in_non_barrel_is_reported(self):
        path = "a.ts"
        lines = ["export { X } from './b.js'\n"]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "value re-export" in v[0][1]

    def test_type_reexport_in_non_barrel_is_allowed(self):
        path = "a.ts"
        lines = [
            "export type { X } from './b.js'\n",
            "export { y }\n",
        ]
        assert mod.check_export_blocks(lines, path) == []

    def test_multiple_type_reexports_are_reported_at_first_line(self):
        path = "a.ts"
        lines = [
            "export type { X } from './a.js'\n",
            "export type { Y } from './b.js'\n",
        ]
        v = mod.check_export_blocks(lines, path)
        assert len(v) == 1
        assert v[0][0] == 1
        assert "2 type export blocks" in v[0][1]

    def test_comment_export_is_ignored(self):
        path = "a.ts"
        lines = [
            "// export { x }\n",
            "// export { y }\n",
            "export { z }\n",
        ]
        assert mod.check_export_blocks(lines, path) == []


class TestCheckPluralNames:
    """Rule 2: singular file names only."""

    def test_plural_name_is_reported(self):
        v = mod.check_plural_names("files.ts")
        assert len(v) == 1
        assert "name `files` looks plural" in v[0][1]

    def test_ses_suffix_is_reported(self):
        v = mod.check_plural_names("cases.ts")
        assert len(v) == 1

    def test_ies_suffix_is_reported(self):
        v = mod.check_plural_names("series.ts")
        assert len(v) == 1

    def test_words_ending_in_s_are_plural(self):
        for name in ["axis.ts", "basis.ts", "thesis.ts", "crisis.ts"]:
            assert mod.check_plural_names(name) != []

    def test_whitelisted_names_are_allowed(self):
        for name in ["pelias.ts", "focus.ts", "canvas.ts", "index.ts"]:
            assert mod.check_plural_names(name) == []

    def test_non_ts_extension_is_allowed(self):
        assert mod.check_plural_names("files.md") == []

    def test_extension_stripping_is_case_sensitive_only_for_ts(self):
        assert mod.check_plural_names("FILES.ts") != []
        assert mod.check_plural_names("files.TS") != []


class TestCheckFile:
    """Filesystem-facing wrapper: read once, run all three rules."""

    def test_missing_file_is_ignored(self):
        missing = Path("definitely-not-here-abc123.ts")
        assert mod.check_file(str(missing)) == []

    def test_invalid_utf8_is_ignored(self, tmp_path):
        f = tmp_path / "bad.ts"
        f.write_bytes(b"\xff\xfe\n")
        assert mod.check_file(str(f)) == []

    def test_clean_file_returns_no_violations(self, tmp_path):
        f = tmp_path / "clean.ts"
        f.write_text("const x = 1\nexport { x }\n", encoding="utf-8")
        assert mod.check_file(str(f)) == []

    def test_plural_file_reports_name_only(self, tmp_path):
        f = tmp_path / "files.ts"
        f.write_text("const x = 1\nexport { x }\n", encoding="utf-8")
        v = mod.check_file(str(f))
        assert len(v) == 1
        assert v[0][0] == 0
        assert "name `files` looks plural" in v[0][1]

    def test_export_violation_reports_line_number(self, tmp_path):
        f = tmp_path / "a.ts"
        f.write_text("export { x }\nexport { y }\n", encoding="utf-8")
        v = mod.check_file(str(f))
        assert len(v) == 1
        assert v[0][0] == 1
        assert "2 value export blocks" in v[0][1]

    def test_spelling_violation_reports_line_number(self, tmp_path):
        f = tmp_path / "a.ts"
        f.write_text("const colour = 1\nexport { x }\n", encoding="utf-8")
        v = mod.check_file(str(f))
        assert len(v) == 1
        assert v[0][0] == 1
        assert "British spelling `colour`" in v[0][1]

    def test_multiple_rules_are_combined(self, tmp_path):
        f = tmp_path / "cases.ts"
        f.write_text(
            "const colour = 1\nexport { colour }\nexport { colour }\n",
            encoding="utf-8",
        )
        v = mod.check_file(str(f))
        assert len(v) == 5
        assert v[0][0] == 2
        assert v[1][0] == 0
        assert v[2][0] == 1
        assert v[3][0] == 2
        assert v[4][0] == 3


class TestMain:
    """CLI behaviour."""

    def test_no_args_returns_zero(self, capsys, monkeypatch):
        assert _run([], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_non_ts_files_are_ignored(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "clean.md"
        f.write_text("const colour = 1\n", encoding="utf-8")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_clean_ts_returns_zero(self, tmp_path, capsys, monkeypatch):
        f = tmp_path / "clean.ts"
        f.write_text("const x = 1\nexport { x }\n", encoding="utf-8")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 0
        captured = capsys.readouterr()
        assert captured.out == ""
        assert captured.err == ""

    def test_violation_reports_location_and_exit_one(
        self, tmp_path, capsys, monkeypatch
    ):
        f = tmp_path / "files.ts"
        f.write_text(
            "const colour = 1\nexport { colour }\nexport { colour }\n", encoding="utf-8"
        )
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert str(f) in captured.out
        assert ":1" in captured.out
        assert "British spelling `colour`" in captured.out
        assert "code-style violation(s)" in captured.err

    def test_summary_mentions_eslint_responsibilities(
        self, tmp_path, capsys, monkeypatch
    ):
        f = tmp_path / "bad.ts"
        f.write_text("export { a }\nexport { b }\n", encoding="utf-8")
        assert _run([str(f)], capsys=capsys, monkeypatch=monkeypatch) == 1
        captured = capsys.readouterr()
        assert "func-style" in captured.err
        assert "no-restricted-syntax" in captured.err
