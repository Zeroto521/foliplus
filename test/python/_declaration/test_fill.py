"""Tests for the fill declaration (``foliplus._declaration.fill``)."""

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


class TestNormaliseFill:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_fill(None, owner="Owner") is None

        assert caught == []

    def test_a_solid_fill_with_color_and_opacity_is_returned(self) -> None:
        assert normalise_fill(
            {"mode": "solid", "color": "#FF0000", "opacity": 0.5}, owner="Owner"
        ) == {"mode": "solid", "color": "#ff0000", "opacity": 0.5}

    def test_a_color_implies_solid_mode(self) -> None:
        assert normalise_fill({"color": "#abc"}, owner="Owner") == {
            "mode": "solid",
            "color": "#aabbcc",
        }

    def test_an_opacity_implies_solid_mode(self) -> None:
        assert normalise_fill({"opacity": 0.4}, owner="Owner") == {
            "mode": "solid",
            "opacity": 0.4,
        }

    def test_a_flat_field_is_an_implicit_value_mode(self) -> None:
        assert normalise_fill({"field": "score"}, owner="Owner") == {
            "mode": "value",
            "field": "score",
        }

    def test_a_value_mode_shell_is_returned(self) -> None:
        assert normalise_fill(
            {"mode": "value", "field": "score", "scheme": "Reds"}, owner="Owner"
        ) == {"mode": "value", "field": "score"}

    def test_opacity_rides_value_mode(self) -> None:
        assert normalise_fill(
            {"mode": "value", "field": "score", "opacity": 0.3}, owner="Owner"
        ) == {"mode": "value", "field": "score", "opacity": 0.3}

    def test_an_original_fill_keeps_the_opacity(self) -> None:
        assert normalise_fill({"mode": "original", "opacity": 0.8}, owner="Owner") == {
            "mode": "original",
            "opacity": 0.8,
        }

    def test_a_color_contradicts_value_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill(
                    {"mode": "value", "field": "score", "color": "#ff0000"},
                    owner="Owner",
                )
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_color_contradicts_original_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill({"mode": "original", "color": "#ff0000"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_field_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill({"mode": "solid", "field": "score"}, owner="Owner")
                is None
            )

        assert "contradicts" in str(record[0].message)

    def test_a_value_key_contradicts_solid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert (
                normalise_fill({"mode": "solid", "method": "equal"}, owner="Owner")
                is None
            )

        assert "does not classify by value" in str(record[0].message)

    def test_a_value_mode_without_a_field_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill({"mode": "value"}, owner="Owner") is None

        assert "requires a field" in str(record[0].message)

    def test_an_empty_fill_warns_and_degrades(self) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill({}, owner="Owner") is None

        assert "without a mode" in str(record[0].message)

    @pytest.mark.parametrize("color", ["red", "#12", 7, ""])
    def test_an_invalid_color_warns_and_drops_only_that_key(
        self, color: object
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill({"mode": "solid", "color": color}, owner="Owner") == {
                "mode": "solid"
            }

        assert "color" in str(record[0].message)

    @pytest.mark.parametrize("opacity", [-0.1, 1.1, "0.5", True, float("nan")])
    def test_an_invalid_opacity_warns_and_drops_only_that_key(
        self, opacity: object
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_fill(
                {"mode": "solid", "opacity": opacity}, owner="Owner"
            ) == {"mode": "solid"}

        assert "opacity" in str(record[0].message)

    def test_an_unknown_key_warns_but_keeps_the_valid_mode(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalised = normalise_fill(
                {"mode": "solid", "color": "#ff0000", "dash": "4 4"}, owner="Owner"
            )

        assert normalised == {"mode": "solid", "color": "#ff0000"}
        assert "with unknown key 'dash'" in str(record[0].message)

    def test_the_message_names_the_layer(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_fill({"mode": "nope"}, owner="layer 'roads'")

        message = str(record[0].message)
        assert "layer 'roads' declares foliplus['fill']" in message

    def test_never_raises_on_any_input(self) -> None:
        for raw in [
            None,
            {"mode": "solid"},
            {"field": "x"},
            {},
            42,
            "x",
            [],
            object(),
        ]:
            try:
                normalise_fill(raw, owner="Owner")
            except Exception as exc:  # pragma: no cover - must never raise
                pytest.fail(f"normalise_fill({raw!r}) raised {exc!r}")


# ── Module-constants placement guard ─────────────────────────────────────
# A regression guard for the top-of-file "Module constants" block: every
# module-level binding — plain assignment, annotated assignment, augmented
# assignment, a module-level walrus, or an import — must sit above the first
# function/class definition, so a new constant cannot be dropped mid-module
# and escape the single block the module docstring promises. The check is
# deliberately declaration-scoped: it inspects only the module body, never a
# function/class body (a binding inside a definition is inherently after the
# first definition and would be a false positive). Parametrised over the
# reader and its own test module, plus negative fixtures that prove the
# guard actually sees each late-binding shape it claims to.
