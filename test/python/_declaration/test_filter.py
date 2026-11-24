"""Tests for the filter reader (``foliplus._declaration.filter``)."""

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

class TestJsonNumber:
    def test_integral_values_become_plain_int(self) -> None:
        assert json_number(3) == 3
        assert type(json_number(3)) is int

    def test_real_values_become_float(self) -> None:
        value = json_number(Fraction(1, 2))

        assert value == 0.5
        assert type(value) is float

class TestRangeAtom:
    def test_a_valid_range_is_a_between_atom_on_the_bound_field(self) -> None:
        assert range_atom({"min": 10, "max": 50}, "HeatmapControl", "score") == {
            "kind": "atom",
            "field": "score",
            "op": "between",
            "range": [10, 50],
        }

    def test_a_field_key_is_api_misuse_and_raises(self) -> None:
        with pytest.raises(ValueError, match="drop 'field' from filter="):
            range_atom(
                {"field": "score", "min": 10, "max": 50}, "HeatmapControl", "score"
            )

    def test_a_range_without_a_bound_field_is_api_misuse_and_raises(self) -> None:
        with pytest.raises(ValueError, match="needs the aggregation field"):
            range_atom({"min": 10, "max": 50}, "HeatmapControl", None)

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            ({"min": 10}, "needs both 'min' and 'max'"),
            ({"min": 10, "max": 20, "between": [1, 2]}, "unknown key(s)"),
            ({"min": "10-50", "max": 60}, "must be a finite number"),
            ({"min": 10, "max": True}, "must be a finite number"),
            ({"min": 10, "max": float("inf")}, "must be a finite number"),
            ({"min": 50, "max": 10}, "inverted (min > max)"),
        ],
    )
    def test_unusable_ranges_warn_and_return_none(
        self, raw: object, reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert range_atom(raw, "HeatmapControl", "score") is None

        assert reason in str(record[0].message)

class TestEnumAtom:
    def test_values_are_deduplicated_in_first_seen_order(self) -> None:
        assert enum_atom(
            ["polygon", "distance", "polygon"], "MeasureControl", MEASURE_TYPE_FIELD
        ) == {
            "kind": "enum",
            "field": "type",
            "values": ["polygon", "distance"],
        }

    @pytest.mark.parametrize(
        ("raw", "reason"),
        [
            (["distance", 3], "non-empty strings"),
            (["distance", ""], "non-empty strings"),
            ([None], "non-empty strings"),
            ([], "empty list"),
        ],
    )
    def test_unusable_values_warn_and_return_none(
        self, raw: list[object], reason: str
    ) -> None:
        with pytest.warns(UserWarning) as record:
            assert enum_atom(raw, "MeasureControl", MEASURE_TYPE_FIELD) is None

        assert reason in str(record[0].message)

class TestNormalizeDeclaredFilter:
    def test_absent_is_none_without_a_warning(self) -> None:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert normalize_declared_filter(None, owner="Owner", kind="range") is None

        assert caught == []

    def test_the_range_kind_delegates_to_the_range_atom(self) -> None:
        assert normalize_declared_filter(
            {"min": 10, "max": 50},
            owner="HeatmapControl",
            kind="range",
            bound_field="score",
        ) == range_atom({"min": 10, "max": 50}, "HeatmapControl", "score")

    def test_the_range_kind_rejects_a_list_and_points_at_measurecontrol(self) -> None:
        with pytest.raises(ValueError, match="enum filters belong to MeasureControl"):
            normalize_declared_filter(
                ["score"],
                owner="HeatmapControl",
                kind="range",
                bound_field="score",
            )

    def test_the_range_kind_warns_on_a_non_mapping_scalar(self) -> None:
        with pytest.warns(UserWarning, match="must be a mapping with min and max"):
            assert (
                normalize_declared_filter(
                    "score",
                    owner="HeatmapControl",
                    kind="range",
                    bound_field="score",
                )
                is None
            )

    def test_the_list_kind_delegates_to_the_enum_atom(self) -> None:
        assert normalize_declared_filter(
            ["distance"], owner="MeasureControl", kind="enum", enum_field="type"
        ) == enum_atom(["distance"], "MeasureControl", "type")

    def test_the_list_kind_rejects_a_non_sequence(self) -> None:
        with pytest.warns(UserWarning, match="must be a list of value names"):
            assert (
                normalize_declared_filter(
                    {"field": "type"},
                    owner="MeasureControl",
                    kind="enum",
                    enum_field="type",
                )
                is None
            )

    def test_the_list_kind_requires_an_enum_field(self) -> None:
        with pytest.raises(ValueError, match="requires enum_field"):
            normalize_declared_filter(["distance"], owner="MeasureControl", kind="enum")


# ── Folder declaration ───────────────────────────────────────────────────

def test_normalise_layer_filter_forms():
    assert normalise_layer_filter(
        {"field": "pop", "min": 0, "max": 100}, owner="Owner"
    ) == {
        "kind": "atom",
        "field": "pop",
        "op": "between",
        "range": [0, 100],
    }
    assert normalise_layer_filter(
        {"field": "cat", "values": ["A", "B", "A"]}, owner="Owner"
    ) == {
        "kind": "enum",
        "field": "cat",
        "values": ["A", "B"],
    }
    assert normalise_layer_filter(None, owner="Owner") is None

def test_normalise_layer_filter_invalid_warns():
    # Non-mapping and malformed shapes warn once and read as undeclared. The
    # dedup store is cleared per shape: two shapes can share a reason (e.g. a
    # missing and a non-string field both say 'field'), and the second would
    # otherwise be suppressed as a repeat.
    for raw in (
        ["x"],
        {"min": 0, "max": 1},
        {"field": "x", "values": ["A"], "min": 0},
        {"field": "pop", "min": 10, "max": 1},
        {"field": "x", "values": []},
        {"field": "x", "foo": 1},
        {"field": 1, "min": 0, "max": 1},
    ):
        _declaration.foliplus_reports.clear()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert (
                normalise_layer_filter(raw, owner="Owner", subject="layer 'L'") is None
            )
            assert any("filter" in str(w.message) for w in caught), (
                raw,
                [str(w.message) for w in caught],
            )

def test_normalise_layer_filter_extra_shape_branches():
    # Branches the forms/invalid tests above do not reach: a 'values' payload
    # that is not a list, a non-string 'values' entry, a declaration with a
    # valid field but neither min/max nor values, and a non-finite bound.
    for raw in (
        {"field": "cat", "values": "A"},  # values as a bare string
        {"field": "cat", "values": ["A", 3]},  # non-string entry
        {"field": "cat"},  # valid field, no form chosen
        {"field": "pop", "min": 0, "max": float("inf")},  # non-finite bound
    ):
        _declaration.foliplus_reports.clear()
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            assert (
                normalise_layer_filter(raw, owner="Owner", subject="layer 'L'") is None
            )
            assert any("filter" in str(w.message) for w in caught), (
                raw,
                [str(w.message) for w in caught],
            )


# marker_color normalisation: shape here; the preset vocabulary is the JS
# reader's, so an out-of-vocabulary name deliberately survives this layer.
