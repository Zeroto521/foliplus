"""Tests for the border declaration (``foliplus._declaration.paint``)."""

from __future__ import annotations

import ast
import re
import warnings
from fractions import Fraction
from pathlib import Path
from types import MappingProxyType

import pytest

from foliplus import _declaration
from foliplus._declaration import (
    MEASURE_TYPE_FIELD,
    enum_atom,
    json_number,
    normalise_border,
    normalise_fill,
    normalise_folder,
    normalise_icon_size,
    normalise_layer_filter,
    normalise_marker_color,
    normalise_zoom_range,
    normalize_declared_filter,
    range_atom,
    should_report,
    warn_foliplus,
    zoom_level,
)

class TestNormaliseBorder:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_border(None, owner="Owner") is None

        assert caught == []

    def test_a_valid_follow_fill_declaration_is_returned(self) -> None:
        assert normalise_border({"mode": "follow_fill"}, owner="Owner") == {
            "mode": "follow_fill"
        }

    def test_an_unknown_mode_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert "with a mode 'nope'" in str(record[0].message)

    def test_a_missing_mode_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({}, owner="Owner") is None

        assert "without a mode or a field" in str(record[0].message)

    def test_a_value_mode_shell_is_returned(self) -> None:
        assert normalise_border(
            {"mode": "value", "field": "count", "scheme": "Reds"}, owner="Owner"
        ) == {"mode": "value", "field": "count"}

    def test_a_flat_fill_isomorphic_form_is_an_implicit_value_mode(self) -> None:
        assert normalise_border({"field": "count"}, owner="Owner") == {
            "mode": "value",
            "field": "count",
        }

    def test_a_value_mode_without_a_field_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "value"}, owner="Owner") is None

        assert "requires a field" in str(record[0].message)

    def test_a_follow_fill_with_a_field_is_a_contradiction(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border(
                    {"mode": "follow_fill", "field": "count"}, owner="Owner"
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_an_unknown_mode_message_names_the_literals(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert "expected 'follow_fill', 'value', 'solid' or 'original'" in str(
            record[0].message
        )

    def test_an_unknown_key_warns_but_keeps_the_valid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalised = normalise_border(
                {"mode": "follow_fill", "dash": "4 4"}, owner="Owner"
            )

        assert normalised == {"mode": "follow_fill"}
        assert "with unknown key 'dash'" in str(record[0].message)

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ("follow_fill", "as str; expected a mapping"),
            (["follow_fill"], "as list; expected a mapping"),
            (42, "as int; expected a mapping"),
        ],
    )
    def test_a_non_mapping_warns_and_degrades(self, raw: object, reason: str) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(raw, owner="Owner") is None

        assert reason in str(record[0].message)

    def test_the_message_names_the_layer(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_border({"mode": "nope"}, owner="layer 'roads'")

        message = str(record[0].message)
        assert "layer 'roads' declares foliplus['border']" in message

    def test_the_message_uses_the_source_it_was_written_with(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_border(
                {"mode": "nope"},
                owner="LayerControl",
                source="foliplus['border']",
            )

        message = str(record[0].message)
        assert "LayerControl declares foliplus['border']" in message

    def test_the_same_defect_is_reported_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                assert normalise_border({"mode": "nope"}, owner="Owner") is None

        assert len(caught) == 1

    def test_never_raises_on_any_input(self) -> None:
        for raw in [
            None,
            {"mode": "follow_fill"},
            {"mode": "value", "field": "count"},
            {"field": "count"},
            {"mode": "nope"},
            {},
            42,
            "x",
            [],
            object(),
        ]:
            try:
                normalise_border(raw, owner="Owner")
            except Exception as exc:  # pragma: no cover - must never raise
                pytest.fail(f"normalise_border({raw!r}) raised {exc!r}")

    def test_a_solid_border_with_color_and_weight_is_returned(self) -> None:
        assert normalise_border(
            {"mode": "solid", "color": "#FF0000", "weight": 2}, owner="Owner"
        ) == {"mode": "solid", "color": "#ff0000", "weight": 2}

    def test_a_color_implies_solid_mode(self) -> None:
        assert normalise_border({"color": "#abc"}, owner="Owner") == {
            "mode": "solid",
            "color": "#aabbcc",
        }

    def test_a_weight_implies_solid_mode(self) -> None:
        assert normalise_border({"weight": 3}, owner="Owner") == {
            "mode": "solid",
            "weight": 3,
        }

    def test_weight_rides_follow_fill(self) -> None:
        assert normalise_border(
            {"mode": "follow_fill", "weight": 2}, owner="Owner"
        ) == {
            "mode": "follow_fill",
            "weight": 2,
        }

    def test_an_original_border_keeps_the_weight(self) -> None:
        assert normalise_border({"mode": "original", "weight": 1.5}, owner="Owner") == {
            "mode": "original",
            "weight": 1.5,
        }

    def test_a_color_contradicts_value_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border(
                    {"mode": "value", "field": "count", "color": "#ff0000"},
                    owner="Owner",
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_field_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border({"mode": "solid", "field": "count"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_value_key_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_border({"mode": "solid", "scheme": "Reds"}, owner="Owner")
                is None
            )

        assert "does not classify by value" in str(record[0].message)

    @pytest.mark.parametrize("color", ["red", "#12", 7, ""])
    def test_an_invalid_color_warns_and_drops_only_that_key(
        self, color: object
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(
                {"mode": "solid", "color": color}, owner="Owner"
            ) == {"mode": "solid"}

        assert "color" in str(record[0].message)

    @pytest.mark.parametrize("weight", [0, -1, "2", True, float("nan")])
    def test_an_invalid_weight_warns_and_drops_only_that_key(
        self, weight: object
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_border(
                {"mode": "solid", "weight": weight}, owner="Owner"
            ) == {"mode": "solid"}

        assert "weight" in str(record[0].message)
