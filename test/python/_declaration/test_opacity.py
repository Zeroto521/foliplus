"""Tests for the opacity declaration (foliplus._declaration.opacity)."""

from __future__ import annotations

import math
import warnings

import pytest

from foliplus._declaration import (
    normalise_color_opacity,
    normalise_opacity,
)


class TestNormaliseOpacity:
    """The whole-layer opacity (0-1, Leaflet opacity unit)."""

    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_opacity(None, owner="Owner") is None
        assert caught == []

    def test_a_finite_in_range_value_is_returned(self) -> None:
        assert normalise_opacity(0.6, owner="Owner") == 0.6
        assert normalise_opacity(0.0, owner="Owner") == 0.0
        assert normalise_opacity(1.0, owner="Owner") == 1.0

    def test_an_integer_inside_the_unit_is_accepted(self) -> None:
        assert normalise_opacity(1, owner="Owner") == 1.0

    def test_a_bool_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
            assert normalise_opacity(True, owner="Owner") is None

    def test_a_non_number_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
            assert normalise_opacity("0.5", owner="Owner") is None

    def test_a_non_finite_value_is_rejected_with_a_warning(self) -> None:
        for bad in (math.nan, math.inf, -math.inf):
            with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
                assert normalise_opacity(bad, owner="Owner") is None

    def test_an_out_of_range_value_is_rejected_with_a_warning(self) -> None:
        for bad in (-0.1, 1.1):
            with pytest.warns(UserWarning, match="expected a number from 0 to 1"):
                assert normalise_opacity(bad, owner="Owner") is None

    def test_the_subject_and_source_are_in_the_warning(self) -> None:
        with pytest.warns(UserWarning, match="layer Rivers"):
            normalise_opacity(
                2.0,
                owner="LayerControl",
                subject="layer Rivers",
                source="foliplus['opacity']",
            )


class TestNormaliseColorOpacity:
    """The marker glyph / chassis alpha (0-100 integer percent)."""

    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_color_opacity(None, owner="Owner") is None
        assert caught == []

    def test_a_whole_number_percent_is_returned(self) -> None:
        assert normalise_color_opacity(60, owner="Owner") == 60
        assert normalise_color_opacity(0, owner="Owner") == 0
        assert normalise_color_opacity(100, owner="Owner") == 100

    def test_a_bool_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            assert normalise_color_opacity(False, owner="Owner") is None

    def test_a_fractional_percent_is_rejected_with_a_warning(self) -> None:
        with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
            assert normalise_color_opacity(60.5, owner="Owner") is None

    def test_an_out_of_range_percent_is_rejected_with_a_warning(self) -> None:
        for bad in (-1, 101):
            with pytest.warns(UserWarning, match="expected a whole number from 0 to 100"):
                assert normalise_color_opacity(bad, owner="Owner") is None

    def test_the_subject_and_source_are_in_the_warning(self) -> None:
        with pytest.warns(UserWarning, match="layer Stations"):
            normalise_color_opacity(
                101,
                owner="LayerControl",
                subject="layer Stations",
                source="foliplus['icon']['colorOpacity']",
            )
