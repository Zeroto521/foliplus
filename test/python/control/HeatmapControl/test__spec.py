"""Tests for the HeatmapControl CONFIG surface (control/HeatmapControl/_spec.py)."""

from __future__ import annotations

from typing import get_args, get_type_hints

from foliplus._config_schema import FieldSpec
from foliplus._declaration import NumberFormat
from foliplus.control.HeatmapControl import HeatmapControl
from foliplus.control.HeatmapControl._spec import (
    AGG,
    DEFAULT_SCHEMES,
    LABEL_FORMAT,
    METHOD,
    ZOOM_RANGE_ARG,
)


def _field_spec(alias: object) -> FieldSpec:
    """The FieldSpec metadata carried by one Annotated alias."""
    return get_args(alias)[1]


class TestHeatmapSpec:
    """The split module keeps the vocabulary and schema metadata the class reads."""

    def test_the_vocabularies_keep_their_words(self) -> None:
        assert get_args(METHOD) == ("jenks", "quantile", "equal", "heads")
        assert get_args(AGG) == ("count", "sum", "avg", "min", "max")
        assert get_args(NumberFormat) == ("auto", "int", "comma", "percent")

    def test_the_default_schemes_are_the_seven_shared_names(self) -> None:
        assert DEFAULT_SCHEMES == [
            "Blues",
            "Greens",
            "Reds",
            "Oranges",
            "Purples",
            "YlOrRd",
            "Viridis",
        ]

    def test_the_zoom_range_alias_owns_the_named_schema(self) -> None:
        spec = _field_spec(ZOOM_RANGE_ARG)
        assert (spec.name, spec.ts, spec.config_key) == (
            "ZoomRange",
            "ZoomRange",
            "zoom_range",
        )
        assert spec.shape == {"min": "number", "max": "number"}

    def test_the_label_format_alias_names_the_number_style(self) -> None:
        spec = _field_spec(LABEL_FORMAT)
        assert spec.name == "NumberStyle"

    def test_the_constructor_annotations_resolve_through_the_aliases(self) -> None:
        hints = get_type_hints(HeatmapControl.__init__, include_extras=True)
        assert _field_spec(hints["zoom_range"]).name == "ZoomRange"
        assert _field_spec(hints["label_format"]).name == "NumberStyle"
