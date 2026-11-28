"""Tests for the HeatmapControl CONFIG surface (control/HeatmapControl/_spec.py)."""

from __future__ import annotations

from typing import Any, get_args, get_type_hints

import pytest

from foliplus._config_schema import FieldSpec
from foliplus._declaration import NumberFormat
from foliplus.control.HeatmapControl import HeatmapControl
from foliplus.control.HeatmapControl._spec import (
    AGG,
    DEFAULT_SCHEMES,
    FIELD_ARG,
    FILTER_ARG,
    FOLDER_ARG,
    LABEL_FORMAT,
    LAYER_ARG,
    METHOD,
    SCHEMES_ARG,
    ZOOM_RANGE_ARG,
)


def _field_spec(alias: object) -> FieldSpec:
    """The FieldSpec metadata carried by one Annotated alias."""
    return get_args(alias)[1]


#: Every alias the constructor signature uses: the base type it wraps and the
#: FieldSpec fields the generated schema reads from it. Pinning all six keeps
#: the split from silently dropping one alias's metadata (config-schema verify
#: is the backstop; this is the module's own contract).
ANNOTATED_ALIASES = [
    (LAYER_ARG, str | None, (None, "", None, None)),
    (FIELD_ARG, str | None, (None, "", None, None)),
    (FILTER_ARG, dict[str, Any] | None, (None, "", None, None)),
    (SCHEMES_ARG, list[str], (None, "", None, None)),
    (
        ZOOM_RANGE_ARG,
        dict[str, Any] | None,
        ("ZoomRange", "ZoomRange", "zoom_range", {"min": "number", "max": "number"}),
    ),
    (FOLDER_ARG, str | None, (None, "string", None, None)),
]


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

    @pytest.mark.parametrize(
        ("alias", "base", "expected"),
        ANNOTATED_ALIASES,
        ids=["layer", "field", "filter", "schemes", "zoom_range", "folder"],
    )
    def test_every_constructor_alias_carries_its_field_spec(
        self, alias: object, base: object, expected: tuple[object, ...]
    ) -> None:
        annotated_base, spec = get_args(alias)
        assert annotated_base == base
        assert isinstance(spec, FieldSpec)
        name, ts, config_key, shape = expected
        assert (spec.name, spec.ts, spec.config_key, spec.shape) == (
            name,
            ts,
            config_key,
            shape,
        )
        # The generated TS comment comes from the note; an empty one would
        # silently strip the schema documentation.
        assert spec.note.strip()
        # Essential-ness comes from the signature default, never from the spec.
        assert (spec.optional, spec.nullable, spec.values) == (False, False, None)

    def test_the_label_format_alias_names_the_number_style(self) -> None:
        spec = _field_spec(LABEL_FORMAT)
        assert spec.name == "NumberStyle"

    def test_the_constructor_annotations_resolve_through_the_aliases(self) -> None:
        hints = get_type_hints(HeatmapControl.__init__, include_extras=True)
        assert hints["label_format"] == LABEL_FORMAT
        for name, alias in [
            ("layer", LAYER_ARG),
            ("field", FIELD_ARG),
            ("filter", FILTER_ARG),
            ("schemes", SCHEMES_ARG),
            ("zoom_range", ZOOM_RANGE_ARG),
            ("folder", FOLDER_ARG),
        ]:
            assert hints[name] == alias
