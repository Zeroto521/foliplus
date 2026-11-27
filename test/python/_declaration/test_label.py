"""Tests for the label declaration (foliplus._declaration.label)."""

from __future__ import annotations

import math
import warnings

import pytest

from foliplus._declaration import NUMBER_FORMATS, normalise_label


class TestNormaliseLabel:
    """The per-layer label block: value validation and warning."""

    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_label(None, owner="Owner") is None
        assert caught == []

    def test_a_non_mapping_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping"):
            assert normalise_label("name", owner="Owner") is None

    def test_a_full_block_is_normalised_to_its_partial_record(self) -> None:
        assert normalise_label(
            {
                "field": "name",
                "format": "comma",
                "color": "#0F0",
                "size": 24,
                "collide": False,
                "show": False,
            },
            owner="Owner",
        ) == {
            "field": "name",
            "format": "comma",
            "color": "#00ff00",
            "size": 24,
            "collide": False,
            "show": False,
        }

    def test_a_field_is_stripped_and_turns_the_labels_on(self) -> None:
        record = normalise_label({"field": "  name  "}, owner="Owner")
        assert record == {"field": "name", "show": True}

    def test_an_explicit_show_false_survives_a_declared_field(self) -> None:
        record = normalise_label({"field": "name", "show": False}, owner="Owner")
        assert record == {"field": "name", "show": False}

    def test_show_without_a_field_is_carried(self) -> None:
        assert normalise_label({"show": True}, owner="Owner") == {"show": True}

    def test_a_non_string_field_warns_and_drops_only_that_key(self) -> None:
        with pytest.warns(UserWarning, match="with a field 1200"):
            record = normalise_label({"field": 1200, "format": "comma"}, owner="Owner")
        assert record == {"format": "comma"}

    def test_a_blank_field_warns(self) -> None:
        with pytest.warns(UserWarning, match="empty or whitespace-only field"):
            assert normalise_label({"field": "   "}, owner="Owner") is None

    def test_every_declared_format_is_accepted(self) -> None:
        for fmt in NUMBER_FORMATS:
            assert (
                normalise_label({"field": "name", "format": fmt}, owner="Owner")[
                    "format"
                ]
                == fmt
            )

    def test_an_unknown_format_warns(self) -> None:
        with pytest.warns(UserWarning, match="with a format 'thousands'"):
            record = normalise_label(
                {"field": "name", "format": "thousands"}, owner="Owner"
            )
        assert "format" not in record

    def test_a_non_string_format_warns(self) -> None:
        with pytest.warns(UserWarning, match="with a format 3"):
            assert normalise_label({"field": "name", "format": 3}, owner="Owner") == {
                "field": "name",
                "show": True,
            }

    def test_a_three_digit_hex_is_expanded_and_lowered(self) -> None:
        assert normalise_label({"color": "#ABC"}, owner="Owner") == {"color": "#aabbcc"}

    def test_a_non_hex_colour_warns(self) -> None:
        with pytest.warns(UserWarning, match="expected a CSS hex"):
            assert normalise_label({"color": "green"}, owner="Owner") is None

    def test_an_explicit_none_colour_warns(self) -> None:
        with pytest.warns(UserWarning, match="with a color None"):
            assert normalise_label({"color": None}, owner="Owner") is None

    def test_the_size_bounds_are_inclusive(self) -> None:
        assert normalise_label({"size": 6}, owner="Owner") == {"size": 6}
        assert normalise_label({"size": 32}, owner="Owner") == {"size": 32}

    def test_an_out_of_range_size_warns_and_is_clamped(self) -> None:
        with pytest.warns(UserWarning, match="clamped to 32"):
            assert normalise_label({"size": 99}, owner="Owner") == {"size": 32}
        with pytest.warns(UserWarning, match="clamped to 6"):
            assert normalise_label({"size": 1}, owner="Owner") == {"size": 6}

    def test_a_non_numeric_size_warns(self) -> None:
        with pytest.warns(UserWarning, match="with a size '12'"):
            assert normalise_label({"size": "12"}, owner="Owner") is None

    def test_a_bool_size_warns(self) -> None:
        with pytest.warns(UserWarning, match="with a size True"):
            assert normalise_label({"size": True}, owner="Owner") is None

    def test_a_non_finite_size_warns(self) -> None:
        for bad in (math.nan, math.inf, -math.inf):
            with pytest.warns(UserWarning, match="with a size"):
                assert normalise_label({"size": bad}, owner="Owner") is None

    def test_collide_and_show_require_bools(self) -> None:
        with pytest.warns(UserWarning, match="with a collide 'yes'"):
            assert normalise_label(
                {"field": "name", "collide": "yes"}, owner="Owner"
            ) == {"field": "name", "show": True}
        with pytest.warns(UserWarning, match="with a show 'yes'"):
            assert normalise_label({"field": "name", "show": "yes"}, owner="Owner") == {
                "field": "name",
                "show": True,
            }

    def test_an_unknown_key_warns_and_the_siblings_still_apply(self) -> None:
        with pytest.warns(UserWarning, match="unknown key 'fields'"):
            record = normalise_label({"field": "name", "fields": "typo"}, owner="Owner")
        assert record == {"field": "name", "show": True}

    def test_a_block_with_nothing_usable_is_none(self) -> None:
        with pytest.warns(UserWarning):
            assert normalise_label({"format": "thousands"}, owner="Owner") is None

    def test_a_mixed_key_payload_warns_instead_of_raising(self) -> None:
        with pytest.warns(UserWarning, match="unknown key 1"):
            assert normalise_label({1: "x"}, owner="Owner") is None

    def test_the_subject_and_source_are_in_the_warning(self) -> None:
        with pytest.warns(UserWarning, match="layer Rivers"):
            normalise_label(
                {"format": "thousands"},
                owner="LayerControl",
                subject="layer Rivers",
                source="foliplus['label']",
            )
