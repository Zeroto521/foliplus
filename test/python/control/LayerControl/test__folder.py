"""The central folder-defaults declaration: normalise_folders.

The author passes ``folders={"overlay": [...], "base": [...]}`` to
``LayerControl``; this module normalises it into the CONF contract the JS
side reads. These tests pin the verdict rules: a malformed declaration warns
once and is ignored (never raises, never hides data), same-name declarations
merge last-wins on ``folded``, and the returned mapping always carries both
sections.
"""

from __future__ import annotations

import warnings

import pytest

from foliplus.control.LayerControl._folder import _folder_key, normalise_folders


class TestNormaliseFolders:
    """normalise_folders verdicts: usable / ignored-with-warning."""

    def test_none_is_undeclared(self) -> None:
        assert normalise_folders(None) is None

    def test_non_mapping_is_undeclared(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping of sections"):
            assert normalise_folders("not a mapping") is None

    def test_basic_entries_round_trip(self) -> None:
        result = normalise_folders(
            {
                "overlay": [{"name": "业务数据", "folded": True}],
                "base": [{"name": "底图"}],
            }
        )
        assert result == {
            "overlay": [{"name": "业务数据", "folded": True}],
            "base": [{"name": "底图", "folded": False}],
        }

    def test_missing_section_becomes_empty_list(self) -> None:
        result = normalise_folders({"overlay": [{"name": "A"}]})
        assert result == {"overlay": [{"name": "A", "folded": False}], "base": []}

    def test_unknown_section_is_ignored(self) -> None:
        result = normalise_folders({"bogus": [{"name": "A"}]})
        assert result == {"overlay": [], "base": []}

    def test_unknown_key_rejects_the_entry(self) -> None:
        with pytest.warns(UserWarning, match=r"unknown key\(s\)"):
            result = normalise_folders({"overlay": [{"name": "A", "extra": 1}]})
        assert result == {"overlay": [], "base": []}

    def test_non_bool_folded_warns_and_treats_as_expanded(self) -> None:
        with pytest.warns(UserWarning, match="expected a bool"):
            result = normalise_folders({"overlay": [{"name": "A", "folded": "yes"}]})
        assert result == {"overlay": [{"name": "A", "folded": False}], "base": []}

    def test_non_string_name_warns_and_is_ignored(self) -> None:
        with pytest.warns(UserWarning, match="non-empty string"):
            result = normalise_folders({"overlay": [{"name": 42}]})
        assert result == {"overlay": [], "base": []}

    def test_blank_name_warns_and_is_ignored(self) -> None:
        with pytest.warns(UserWarning, match="empty or whitespace-only"):
            result = normalise_folders({"overlay": [{"name": "   "}]})
        assert result == {"overlay": [], "base": []}

    def test_same_name_merges_last_wins_on_folded(self) -> None:
        result = normalise_folders(
            {
                "overlay": [
                    {"name": "业务数据", "folded": True},
                    {"name": " 业务数据 ", "folded": False},
                ],
            }
        )
        assert result == {
            "overlay": [{"name": "业务数据", "folded": False}],
            "base": [],
        }

    def test_same_name_keeps_first_display_spelling(self) -> None:
        result = normalise_folders(
            {
                "overlay": [
                    {"name": "业务数据"},
                    {"name": " 业务数据 "},
                ],
            }
        )
        assert result == {
            "overlay": [{"name": "业务数据", "folded": False}],
            "base": [],
        }

    def test_entries_must_be_mappings(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping"):
            result = normalise_folders({"overlay": ["not a mapping"]})
        assert result == {"overlay": [], "base": []}


    def test_non_sequence_section_value_warns_and_is_ignored(self) -> None:
        # A section value that is not a sequence (a bare string, a mapping, an
        # int) is rejected wholesale rather than iterated as if it were entries.
        with pytest.warns(UserWarning, match="expected a list"):
            result = normalise_folders({"overlay": "not a list"})
        assert result == {"overlay": [], "base": []}

    def test_mapping_section_value_warns_and_is_ignored(self) -> None:
        # A mapping as a section value is also not a sequence and is rejected.
        with pytest.warns(UserWarning, match="expected a list"):
            result = normalise_folders({"overlay": {"name": "A"}})
        assert result == {"overlay": [], "base": []}

class TestFolderKey:
    """_folder_key mirrors the JS normalizeFolderName."""

    def test_folds_whitespace_and_case(self) -> None:
        assert _folder_key("  A  B ") == _folder_key("a b")

    def test_nfc_normalises_composed_forms(self) -> None:
        assert _folder_key("é") == _folder_key("e\u0301")


class TestLayerControlFoldersConfig:
    """LayerControl(folders=...) serialises the normalised config."""

    def test_default_folders_is_none(self) -> None:
        from foliplus import LayerControl

        assert LayerControl().folders is None

    def test_folders_is_a_config_field(self) -> None:
        from foliplus import LayerControl

        assert "folders" in LayerControl._config_fields

    def test_folders_serialises_into_config(self) -> None:
        import folium

        from foliplus import LayerControl

        ctrl = LayerControl(folders={"overlay": [{"name": "业务数据", "folded": True}]})
        cfg = ctrl._build_config()
        assert cfg["folders"] == {
            "overlay": [{"name": "业务数据", "folded": True}],
            "base": [],
        }

    def test_invalid_folders_serialises_as_none(self) -> None:
        import folium

        from foliplus import LayerControl

        ctrl = LayerControl(folders="bad")
        assert ctrl._build_config()["folders"] is None
