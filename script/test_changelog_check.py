"""Tests for ``script/changelog_check.py`` — CHANGELOG.md invariants.

Two rules are enforced:
  1. Within each bullet, the sequence of ``[#NNN]`` labels is non-decreasing.
  2. Between adjacent bullets in the same ``### Section`` of the same
     ``## [Version]`` heading, the first-number is non-decreasing.

A third check (existence) runs only in CI when GITHUB_TOKEN + GITHUB_REPOSITORY
are set: every referenced #NNN must exist as a real PR or issue.

Coverage target: near 100% branch coverage. Tests assert semantic invariants,
not hardcoded magic numbers.
"""

from __future__ import annotations

import builtins
import importlib.util
import sys
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
SCRIPT = HERE / "changelog_check.py"
REAL_CHANGELOG = REPO_ROOT / "CHANGELOG.md"

# ---------------------------------------------------------------------------
# Module loading
# ---------------------------------------------------------------------------

_spec = importlib.util.spec_from_file_location("changelog_check", SCRIPT)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def fixture(*lines: str) -> str:
    """Minimal CHANGELOG fragment isolating one rule at a time."""
    return "\n".join(
        ["# Changelog", "", "## [Unreleased]", "", "### Added", "", *lines, ""]
    )


def _make_entry(
    line_no: int, version: str, section: str, first_num: int | None, nums: list[int]
) -> mod.Entry:
    return mod.Entry(
        line_no=line_no,
        version=version,
        section=section,
        first_num=first_num,
        nums=nums,
    )


# ---------------------------------------------------------------------------
# extract_label_numbers
# ---------------------------------------------------------------------------


class TestExtractLabelNumbers:
    def test_no_labels(self):
        assert mod.extract_label_numbers("- `XControl`: no numbers here") == []

    def test_document_order_not_numerical(self):
        line = "- foo ([#200](x/pull/200), [#100](x/pull/100), [#300](x/pull/300))"
        assert mod.extract_label_numbers(line) == [200, 100, 300]

    def test_ignores_url_kind(self):
        line = "- mixed ([#164](x/tree/164), [#252](x/issues/252), [#425](x/pull/425))"
        assert mod.extract_label_numbers(line) == [164, 252, 425]


# ---------------------------------------------------------------------------
# check_ordering — within-line rule
# ---------------------------------------------------------------------------


class TestCheckOrderingWithinLine:
    def test_strictly_ascending(self):
        t = fixture("- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))")
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_repeated_number_ok(self):
        t = fixture("- a ([#1](x/pull/1), [#1](x/pull/1), [#2](x/pull/2))")
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_descending_pair_flagged(self):
        t = fixture("- a ([#425](x/pull/425), [#423](x/pull/423))")
        v = mod.check_ordering(mod.parse_entries(t))
        assert len(v) == 1
        assert "[425, 423]" in v[0]["message"]
        assert "non-decreasing" in v[0]["message"]

    def test_mid_list_inversion(self):
        t = fixture(
            "- a ([#1](x/pull/1), [#5](x/pull/5), [#3](x/pull/3), [#9](x/pull/9))"
        )
        v = mod.check_ordering(mod.parse_entries(t))
        assert len(v) == 1
        assert "[1, 5, 3, 9]" in v[0]["message"]


# ---------------------------------------------------------------------------
# check_ordering — between-entry rule
# ---------------------------------------------------------------------------


class TestCheckOrderingBetweenEntry:
    def test_strictly_ascending_first_numbers(self):
        t = fixture(
            "- a ([#1](x/pull/1))", "- b ([#2](x/pull/2))", "- c ([#3](x/pull/3))"
        )
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_ties_on_first_number_ok(self):
        t = fixture(
            "- a ([#122](x/pull/122))",
            "- b ([#122](x/pull/122), [#305](x/pull/305))",
            "- c ([#122](x/pull/122), [#131](x/pull/131))",
            "- d ([#124](x/pull/124))",
        )
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_first_number_regression_flagged(self):
        t = fixture("- a ([#425](x/pull/425))", "- b ([#421](x/pull/421))")
        v = mod.check_ordering(mod.parse_entries(t))
        assert len(v) == 1
        assert "first-number 421" in v[0]["message"]
        assert "425" in v[0]["message"]

    def test_no_compare_across_subsections(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200))",
                "",
                "### Fixed",
                "",
                "- b ([#100](x/pull/100))",
                "",
            ]
        )
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_no_compare_across_versions(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200))",
                "",
                "## [v0.3.0]",
                "",
                "### Added",
                "",
                "- b ([#100](x/pull/100))",
                "",
            ]
        )
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_ignores_entries_with_no_numbers(self):
        t = fixture(
            "- a ([#200](x/pull/200))",
            "- `Add plugins`: no numbers here",
            "- b ([#100](x/pull/100))",
        )
        assert mod.check_ordering(mod.parse_entries(t)) == []

    def test_sub_bullets_not_new_entries(self):
        t = fixture(
            "- a ([#200](x/pull/200))",
            "  - continuation bullet",
            "  - **Why**: because",
            "- b ([#100](x/pull/100))",
        )
        v = mod.check_ordering(mod.parse_entries(t))
        assert len(v) == 1
        assert "first-number 100" in v[0]["message"]


# ---------------------------------------------------------------------------
# collect_label_url_warnings
# ---------------------------------------------------------------------------


class TestCollectLabelUrlWarnings:
    def test_no_warn_when_agree(self):
        t = fixture("- a ([#164](x/tree/164), [#206](x/pull/206))")
        entries = mod.parse_entries(t)
        assert mod.collect_label_url_warnings(entries, t.split("\n")) == []

    def test_flags_disagreement(self):
        t = fixture("- a ([#164](x/tree/999), [#206](x/pull/206))")
        entries = mod.parse_entries(t)
        w = mod.collect_label_url_warnings(entries, t.split("\n"))
        assert len(w) == 1
        assert "#164" in w[0]["message"]
        assert "/999" in w[0]["message"]


# ---------------------------------------------------------------------------
# sort_line_pairs
# ---------------------------------------------------------------------------


class TestSortLinePairs:
    def test_descending_to_ascending(self):
        line = "- a ([#425](x/pull/425), [#423](x/pull/423))"
        assert (
            mod.sort_line_pairs(line) == "- a ([#423](x/pull/423), [#425](x/pull/425))"
        )

    def test_noop_already_sorted(self):
        line = "- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))"
        assert mod.sort_line_pairs(line) == line

    def test_noop_ties(self):
        line = "- a ([#1](x/pull/1), [#1](x/pull/1), [#2](x/pull/2))"
        assert mod.sort_line_pairs(line) == line

    def test_noop_non_adjacent(self):
        line = "- a ([#200](x/pull/200)) blah ([#100](x/pull/100))"
        assert mod.sort_line_pairs(line) == line

    def test_preserves_surrounding_text(self):
        line = "- `Foo`: text ([#200](x/pull/200), [#100](x/pull/100)) trailing"
        result = mod.sort_line_pairs(line)
        assert (
            result == "- `Foo`: text ([#100](x/pull/100), [#200](x/pull/200)) trailing"
        )


# ---------------------------------------------------------------------------
# stable_bubble_sort_by_first_num
# ---------------------------------------------------------------------------


class TestStableBubbleSort:
    def test_ties_keep_order(self):
        blocks = [
            {"lines": ["- a"], "first_num": 122, "nums": [122, 305]},
            {"lines": ["- b"], "first_num": 122, "nums": [122, 131]},
            {"lines": ["- c"], "first_num": 124, "nums": [124]},
        ]
        mod.stable_bubble_sort_by_first_num(blocks)
        assert [b["lines"][0] for b in blocks] == ["- a", "- b", "- c"]

    def test_smaller_moves_before_larger(self):
        blocks = [
            {"lines": ["- a"], "first_num": 200, "nums": [200]},
            {"lines": ["- b"], "first_num": 100, "nums": [100]},
        ]
        mod.stable_bubble_sort_by_first_num(blocks)
        assert [b["lines"][0] for b in blocks] == ["- b", "- a"]

    def test_null_first_num_never_moves(self):
        blocks = [
            {"lines": ["- null"], "first_num": None, "nums": []},
            {"lines": ["- a"], "first_num": 100, "nums": [100]},
            {"lines": ["- null2"], "first_num": None, "nums": []},
        ]
        mod.stable_bubble_sort_by_first_num(blocks)
        assert [b["lines"][0] for b in blocks] == ["- null", "- a", "- null2"]


# ---------------------------------------------------------------------------
# fix_file — end-to-end fix with invariants
# ---------------------------------------------------------------------------


class TestFixFile:
    def test_fixes_both_rules(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200), [#100](x/pull/100))",
                "- b ([#50](x/pull/50))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is True
        lines = new_text.split("\n")
        assert lines[6] == "- b ([#50](x/pull/50))"
        assert lines[7] == "- a ([#100](x/pull/100), [#200](x/pull/200))"
        # Idempotent
        _, changed2, _ = mod.fix_file(new_text)
        assert changed2 is False

    def test_preserves_char_multiset(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200), [#100](x/pull/100))",
                "- b ([#50](x/pull/50))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is True
        from collections import Counter

        before = Counter(t)
        after = Counter(new_text)
        assert after == before

    def test_preserves_line_set_multiset(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200))",
                "- b ([#100](x/pull/100))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is True
        from collections import Counter

        before = Counter(t.split("\n"))
        after = Counter(new_text.split("\n"))
        assert after == before

    def test_guard_catches_bad_fixer(self):
        original = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#100](x/pull/100), [#150](x/pull/150), [#120](x/pull/120))",
                "- b ([#200](x/pull/200))",
                "",
            ]
        )
        bad_fixer = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#100](x/pull/100), [#150](x/pull/150))",
                "- b ([#120](x/pull/120), [#200](x/pull/200))",
                "",
            ]
        )
        from collections import Counter

        # Char multiset is the same — this is why char multiset is insufficient.
        assert Counter(original) == Counter(bad_fixer)
        # But normalized line multiset differs — the guard catches this.
        assert mod.normalized_line_multiset(original) != mod.normalized_line_multiset(bad_fixer)

    def test_guard_passes_correct_fixer(self):
        original = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200), [#100](x/pull/100))",
                "- b ([#50](x/pull/50))",
                "",
            ]
        )
        correct_fixer = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- b ([#50](x/pull/50))",
                "- a ([#100](x/pull/100), [#200](x/pull/200))",
                "",
            ]
        )
        assert mod.normalized_line_multiset(original) == mod.normalized_line_multiset(correct_fixer)

    def test_sub_bullets_move_with_parent(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Changed",
                "",
                "- a ([#200](x/pull/200))",
                "  - **Why**: because",
                "- b ([#100](x/pull/100))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is True
        lines = new_text.split("\n")
        assert lines[6] == "- b ([#100](x/pull/100))"
        assert lines[7] == "- a ([#200](x/pull/200))"
        assert lines[8] == "  - **Why**: because"

    def test_idempotent(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#200](x/pull/200), [#100](x/pull/100))",
                "- b ([#50](x/pull/50))",
                "",
            ]
        )
        first_text, first_changed, _ = mod.fix_file(t)
        assert first_changed is True
        second_text, second_changed, _ = mod.fix_file(first_text)
        assert second_changed is False
        assert second_text == first_text

    def test_noop_already_sorted(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Added",
                "",
                "- a ([#1](x/pull/1))",
                "- b ([#2](x/pull/2))",
                "- c ([#3](x/pull/3))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is False
        assert new_text == t

    def test_ties_on_first_number_ok(self):
        t = "\n".join(
            [
                "# Changelog",
                "",
                "## [Unreleased]",
                "",
                "### Changed",
                "",
                "- a ([#122](x/pull/122), [#305](x/pull/305))",
                "- b ([#122](x/pull/122), [#131](x/pull/131))",
                "- c ([#122](x/pull/122), [#200](x/pull/200))",
                "- d ([#122](x/pull/122), [#389](x/pull/389))",
                "- e ([#124](x/pull/124))",
                "",
            ]
        )
        new_text, changed, error = mod.fix_file(t)
        assert error is None
        assert changed is False
        assert new_text == t


# ---------------------------------------------------------------------------
# check_existence — mocked urlopen
# ---------------------------------------------------------------------------


class _FakeResponse:
    def __init__(self, status: int):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass


def _mock_urlopen(statuses: dict[str, int], calls: list[str]):
    """Return a mock for urllib.request.urlopen that records calls and returns statuses."""

    def _urlopen(req):
        url = req.full_url
        calls.append(url)
        # Extract the trailing number from the URL for status lookup
        tail = url.rstrip("/").rsplit("/", 1)[-1]
        status = statuses.get(tail, 200)
        if status >= 400:
            raise urllib.error.HTTPError(url, status, "error", {}, None)
        return _FakeResponse(status)

    return _urlopen


class TestCheckExistence:
    def test_404_flagged(self):
        entries = mod.parse_entries(fixture("- a ([#99999](x/pull/99999))"))
        with patch.object(
            mod.urllib.request, "urlopen", _mock_urlopen({"99999": 404}, [])
        ):
            violations, error = mod.check_existence(
                entries, "Zeroto521", "foliplus", "tok"
            )
        assert error is None
        assert len(violations) == 1
        assert "#99999" in violations[0]["message"]
        assert "Zeroto521/foliplus" in violations[0]["message"]

    def test_200_all_pass(self):
        entries = mod.parse_entries(
            fixture("- a ([#1](x/pull/1), [#2](x/pull/2), [#3](x/pull/3))")
        )
        with patch.object(mod.urllib.request, "urlopen", _mock_urlopen({}, [])):
            violations, error = mod.check_existence(
                entries, "Zeroto521", "foliplus", "tok"
            )
        assert error is None
        assert violations == []

    def test_sends_repo_scoped_url(self):
        entries = mod.parse_entries(fixture("- a ([#425](x/pull/425))"))
        calls: list[str] = []
        with patch.object(mod.urllib.request, "urlopen", _mock_urlopen({}, calls)):
            mod.check_existence(entries, "Zeroto521", "foliplus", "tok")
        assert calls == ["https://api.github.com/repos/Zeroto521/foliplus/issues/425"]

    def test_deduplicates_numbers(self):
        entries = mod.parse_entries(
            fixture(
                "- a ([#122](x/pull/122), [#125](x/pull/125))",
                "- b ([#122](x/pull/122), [#130](x/pull/130))",
            )
        )
        calls: list[str] = []
        with patch.object(mod.urllib.request, "urlopen", _mock_urlopen({}, calls)):
            mod.check_existence(entries, "Z", "f", "t")
        assert len(calls) == 3  # 122, 125, 130 — not 4

    def test_403_rate_limit_soft_error(self):
        entries = mod.parse_entries(fixture("- a ([#1](x/pull/1))"))
        with patch.object(mod.urllib.request, "urlopen", _mock_urlopen({"1": 403}, [])):
            violations, error = mod.check_existence(entries, "Z", "f", "t")
        assert error is not None
        assert "rate-limit" in error.lower()
        assert violations == []

    def test_fetch_exception_soft_error(self):
        entries = mod.parse_entries(fixture("- a ([#1](x/pull/1))"))

        def _raise_econnrefused(req):
            raise urllib.error.URLError("ECONNREFUSED")

        with patch.object(mod.urllib.request, "urlopen", _raise_econnrefused):
            violations, error = mod.check_existence(entries, "Z", "f", "t")
        assert error is not None
        assert "ECONNREFUSED" in error
        assert violations == []


# ---------------------------------------------------------------------------
# Real CHANGELOG.md snapshot
# ---------------------------------------------------------------------------


class TestRealChangelog:
    REAL_TEXT = REAL_CHANGELOG.read_text(encoding="utf-8")
    ENTRIES = mod.parse_entries(REAL_TEXT)

    def test_parses_non_empty(self):
        assert len(self.ENTRIES) > 0

    def test_zero_violations(self):
        assert mod.check_ordering(self.ENTRIES) == []

    def test_no_label_url_warnings(self):
        warnings = mod.collect_label_url_warnings(
            self.ENTRIES, self.REAL_TEXT.split("\n")
        )
        assert warnings == []

    def test_mega_pr_ties(self):
        expected_ties = [
            ("Unreleased", "Changed", 122, 4),
            ("Unreleased", "Changed", 147, 4),
            ("v0.3.0", "Changed", 37, 2),
            ("v0.3.0", "Fixed", 48, 3),
        ]
        for version, section, first_num, expected in expected_ties:
            actual = sum(
                1
                for e in self.ENTRIES
                if e.version == version
                and e.section == section
                and e.first_num == first_num
            )
            assert actual == expected, f"{version}/{section} first #{first_num}"


# ---------------------------------------------------------------------------
# main() — CLI integration tests
# ---------------------------------------------------------------------------


class TestMain:
    """Test the CLI entry point by mocking IO and capturing exit codes."""

    def test_fix_mode_success(self, tmp_path, capsys):
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#200](x/pull/200), [#100](x/pull/100))\n"
            "- b ([#50](x/pull/50))\n\n",
            encoding="utf-8",
        )
        with patch.object(
            sys, "argv", ["changelog_check.py", "--fix", "--path", str(changelog)]
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        # Exit code 0 (no exit called means success)
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "fixed" in out
        # Verify the file was actually fixed
        content = changelog.read_text(encoding="utf-8")
        assert "- b ([#50](x/pull/50))" in content

    def test_fix_mode_already_sorted(self, tmp_path, capsys):
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#1](x/pull/1))\n- b ([#2](x/pull/2))\n\n",
            encoding="utf-8",
        )
        with patch.object(
            sys, "argv", ["changelog_check.py", "--fix", "--path", str(changelog)]
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "already sorted" in out

    def test_fix_mode_guard_error(self, tmp_path, capsys):
        """Simulate a guard violation by monkey-patching fix_file."""
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#100](x/pull/100))\n\n",
            encoding="utf-8",
        )

        def _fake_fix(text):
            return text, True, "line-level multiset invariant violated"

        with patch.object(mod, "fix_file", _fake_fix):
            with patch.object(
                sys, "argv", ["changelog_check.py", "--fix", "--path", str(changelog)]
            ):
                with patch.object(mod.sys, "exit") as mock_exit:
                    mod.main()
        mock_exit.assert_called_once_with(1)
        err = capsys.readouterr().err
        assert "ERROR" in err

    def test_check_mode_no_violations(self, tmp_path, capsys):
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#1](x/pull/1))\n- b ([#2](x/pull/2))\n\n",
            encoding="utf-8",
        )
        with patch.object(
            sys,
            "argv",
            ["changelog_check.py", "--skip-exists", "--path", str(changelog)],
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "OK" in out
        assert "skipped" in out

    def test_check_mode_violations(self, tmp_path, capsys):
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#200](x/pull/200), [#100](x/pull/100))\n"
            "- b ([#50](x/pull/50))\n\n",
            encoding="utf-8",
        )
        with patch.object(
            sys,
            "argv",
            ["changelog_check.py", "--skip-exists", "--path", str(changelog)],
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        mock_exit.assert_called_once_with(1)
        out = capsys.readouterr().out
        assert "FAIL" in out

    def test_check_mode_existence_check_skipped_no_token(
        self, tmp_path, capsys, monkeypatch
    ):
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a ([#1](x/pull/1))\n\n",
            encoding="utf-8",
        )
        monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        with patch.object(
            sys, "argv", ["changelog_check.py", "--path", str(changelog)]
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "skipped" in out
        assert "no GITHUB_TOKEN" in out

    def test_check_mode_existence_check_with_token(self, tmp_path, capsys, monkeypatch):
        """Existence check runs when GITHUB_REPOSITORY + GITHUB_TOKEN are set."""
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a ([#1](x/pull/1))\n\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("GITHUB_REPOSITORY", "Zeroto521/foliplus")
        monkeypatch.setenv("GITHUB_TOKEN", "tok")
        calls: list[str] = []
        with patch.object(
            mod.urllib.request, "urlopen", _mock_urlopen({"1": 200}, calls)
        ):
            with patch.object(
                sys, "argv", ["changelog_check.py", "--path", str(changelog)]
            ):
                with patch.object(mod.sys, "exit") as mock_exit:
                    mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "OK" in out
        assert calls == ["https://api.github.com/repos/Zeroto521/foliplus/issues/1"]

    def test_check_mode_existence_check_404_violation(
        self, tmp_path, capsys, monkeypatch
    ):
        """404 from GitHub API is reported as a violation."""
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a ([#99999](x/pull/99999))\n\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("GITHUB_REPOSITORY", "Zeroto521/foliplus")
        monkeypatch.setenv("GITHUB_TOKEN", "tok")
        with patch.object(
            mod.urllib.request, "urlopen", _mock_urlopen({"99999": 404}, [])
        ):
            with patch.object(
                sys, "argv", ["changelog_check.py", "--path", str(changelog)]
            ):
                with patch.object(mod.sys, "exit") as mock_exit:
                    mod.main()
        mock_exit.assert_called_once_with(1)
        out = capsys.readouterr().out
        assert "FAIL" in out
        assert "#99999" in out

    def test_check_mode_existence_check_403_soft_error(
        self, tmp_path, capsys, monkeypatch
    ):
        """403 rate limit is a soft error, not a violation."""
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a ([#1](x/pull/1))\n\n",
            encoding="utf-8",
        )
        monkeypatch.setenv("GITHUB_REPOSITORY", "Zeroto521/foliplus")
        monkeypatch.setenv("GITHUB_TOKEN", "tok")
        with patch.object(mod.urllib.request, "urlopen", _mock_urlopen({"1": 403}, [])):
            with patch.object(
                sys, "argv", ["changelog_check.py", "--path", str(changelog)]
            ):
                with patch.object(mod.sys, "exit") as mock_exit:
                    mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "OK" in out
        assert "rate-limit" in out.lower()

    def test_check_mode_label_url_warning(self, tmp_path, capsys, monkeypatch):
        """Label≠URL tail produces a warning, not a violation."""
        changelog = tmp_path / "CHANGELOG.md"
        changelog.write_text(
            "# Changelog\n\n## [Unreleased]\n\n### Added\n\n"
            "- a ([#164](x/tree/999))\n\n",
            encoding="utf-8",
        )
        monkeypatch.delenv("GITHUB_REPOSITORY", raising=False)
        monkeypatch.delenv("GITHUB_TOKEN", raising=False)
        with patch.object(
            sys,
            "argv",
            ["changelog_check.py", "--skip-exists", "--path", str(changelog)],
        ):
            with patch.object(mod.sys, "exit") as mock_exit:
                mod.main()
        assert mock_exit.call_count == 0
        out = capsys.readouterr().out
        assert "warn" in out
        assert "#164" in out

    def test_check_mode_file_not_found(self, tmp_path, capsys):
        with patch.object(
            sys,
            "argv",
            ["changelog_check.py", "--path", str(tmp_path / "nonexistent.md")],
        ):
            with patch.object(mod.sys, "exit", side_effect=SystemExit(2)):
                with pytest.raises(SystemExit):
                    mod.main()
        err = capsys.readouterr().err
        assert "cannot read" in err
