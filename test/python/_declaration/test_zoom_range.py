"""Tests for the zoom-range reader (``foliplus._declaration.zoom_range``)."""

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


class TestZoomLevel:
    def test_accepts_python_integers(self) -> None:
        assert zoom_level(0) == 0
        assert zoom_level(-3) == -3

    def test_narrows_numpy_integers_to_plain_int(self) -> None:
        np = pytest.importorskip("numpy")

        value = zoom_level(np.int64(8))

        assert value == 8
        assert type(value) is int

    @pytest.mark.parametrize(
        "raw",
        [True, False, 8.0, 8.5, "8", None, [8], {"min": 8}],
    )
    def test_rejects_non_integers(self, raw: object) -> None:
        assert zoom_level(raw) is None


class TestNormaliseZoomRange:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalise_zoom_range(None, owner="Owner") is None

        assert caught == []

    def test_a_valid_mapping_is_narrowed_to_min_max(self) -> None:
        assert normalise_zoom_range({"min": 8, "max": 12}, owner="Owner") == {
            "min": 8,
            "max": 12,
        }

    def test_equal_bounds_are_valid(self) -> None:
        assert normalise_zoom_range({"min": 7, "max": 7}, owner="Owner") == {
            "min": 7,
            "max": 7,
        }

    def test_a_generic_mapping_is_accepted(self) -> None:
        declaration = MappingProxyType({"min": 8, "max": 12})

        assert normalise_zoom_range(declaration, owner="Owner") == {
            "min": 8,
            "max": 12,
        }

    def test_numpy_bounds_are_narrowed_to_plain_int(self) -> None:
        np = pytest.importorskip("numpy")

        normalised = normalise_zoom_range(
            {"min": np.int64(8), "max": np.int32(12)}, owner="Owner"
        )

        assert normalised == {"min": 8, "max": 12}
        assert [type(value) for value in normalised.values()] == [int, int]

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ({"min": 12, "max": 8}, "min=12 > max=8"),
            ({"min": 8}, "non-integer max=None"),
            ({"min": 8.5, "max": 12}, "non-integer min=8.5"),
            ({"min": True, "max": 12}, "non-integer min=True"),
            ({"min": "8", "max": "12"}, "non-integer min='8'"),
            ({"min": 8, "max": 12, "step": 1}, "unknown key(s) ['step']"),
            ({1: 8, "min": 8, "max": 12}, "unknown key(s) [1]"),
            ([8, 12], "as list; expected a mapping"),
            ("8-12", "as str; expected a mapping"),
        ],
    )
    def test_unusable_declarations_warn_and_degrade(
        self, raw: object, reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert normalise_zoom_range(raw, owner="Owner") is None

        assert reason in str(record[0].message)

    def test_the_message_names_the_owner_and_the_control_source(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_zoom_range(
                {"min": 8.5, "max": 12},
                owner="HeatmapControl",
                source="zoom_range",
            )

        message = str(record[0].message)
        assert (
            "HeatmapControl declares zoom_range with a non-integer min=8.5" in message
        )
        assert "foliplus[" not in message

    def test_the_message_names_the_layer_and_the_namespace_source(self) -> None:
        with pytest.warns(UserWarning) as record:
            normalise_zoom_range(
                {"min": 8.5, "max": 12},
                owner="LayerControl",
                subject="layer 'roads'",
            )

        message = str(record[0].message)
        assert (
            "LayerControl: layer 'roads' declares foliplus['zoom_range'] "
            "with a non-integer min=8.5"
        ) in message

    def test_the_same_defect_is_reported_once(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            for _ in range(3):
                assert (
                    normalise_zoom_range({"min": 8.5, "max": 12}, owner="Owner") is None
                )

        assert len(caught) == 1

    def test_different_subjects_are_reported_separately(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            normalise_zoom_range(
                {"min": 8.5, "max": 12}, owner="LayerControl", subject="layer 'a'"
            )
            normalise_zoom_range(
                {"min": 8.5, "max": 12}, owner="LayerControl", subject="layer 'b'"
            )

        assert len(caught) == 2


# ── Filter declaration ───────────────────────────────────────────────────
