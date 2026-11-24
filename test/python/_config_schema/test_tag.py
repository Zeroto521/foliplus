"""Tests for the CONFIG tag grammar (``foliplus._config_schema.tag``)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any

import pytest

from foliplus import (
    BaseControl,
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)
from foliplus._config_schema import (
    SHARED,
    UNSET,
    FieldSpec,
    config_fields,
    derive_schema,
    derived_control_schemas,
    render_ts_type,
    schema_to_json,
    validate_shape,
)

from .helper import (
    CONTROL_CLASSES,
    _default_literal,
    _derived,
    _js_files,
    _py_control_field_sets,
    _read_committed_fixture_defaults,
    _schema_defaults,
    _schema_dict,
    _spec_dict,
    _ts_interface_fields,
    _ts_short_to_control,
    _walk_specs,
)


class TestShapeConvention:
    """A shape-driven alias carries its descriptor in the schema.

    Every field that names a generated alias (``FieldSpec.name``) renders as
    ``name`` rather than a primitive, so the alias needs a definition: either a
    ``shape`` descriptor, or — for a literal union like ``NumberStyle`` — the
    ``values`` the union renders from. A named field with neither would render
    a type name nothing defines. ``ts`` sits alongside ``name`` for a
    shape-driven alias by convention, so a ``ts`` is not itself a violation.
    """

    @pytest.mark.parametrize("name", sorted(CONTROL_CLASSES))
    def test_named_fields_have_something_to_render(self, name: str) -> None:
        bad = []
        for field, spec in _derived(name).items():
            if spec.name is not None and not spec.shape and not spec.values:
                bad.append(f"{name}.{field}: name={spec.name!r} with no shape")
        assert not bad, "\n".join(bad)


class TestValidateShape:
    """The shape-descriptor grammar: valid shapes pass, bad ones fail loudly.

    Every error names the path it failed at, so an author fixing a typo knows
    which key to touch. These are the branches :func:`validate_shape` raises
    in — without them the validator would be untested outside the happy path.
    """

    VALID_SHAPES: list[object] = [
        "string",
        {"a": "number", "b": "bool", "c": "null"},
        {"*": "string"},
        {"items": [{"x": "number"}]},
        {"tags": ("auto", "int", "comma")},
        {"params": {"*": ("string", "number")}},
        {"only": ("string",)},
        {"a": ("string", "?")},
        {"nested": {"inner": {"deep": "string"}}},
        {"matrix": [["string"]]},
        # The author scale (LayerData[].fillAuthor.scale): vmin/vmax are
        # optional keys, so a scale that carries them and one that omits them
        # are both legal shapes - the optional marker renders them as
        # vmin?: number / vmax?: number and the missing-key case stays valid.
        {
            "scale": {
                "kind": ("continuous", "stepped"),
                "vmin": ("number", "?"),
                "vmax": ("number", "?"),
            }
        },
        {"scale": {"kind": ("continuous", "stepped")}},
    ]

    @pytest.mark.parametrize("shape", VALID_SHAPES)
    def test_valid_shapes_pass(self, shape: object) -> None:
        validate_shape(shape, "T")

    @pytest.mark.parametrize(
        ("shape", "message"),
        [
            ("int", "unknown primitive"),
            (("string", "?"), "optional marker"),
            (("a", 1), "union elements must be strings"),
            ([], "empty array"),
            ({"*": "string", "b": "string"}, "key cannot be mixed"),
            ({"1abc": "string"}, "not a valid JS identifier"),
            (42, "unknown shape type"),
            ({"ok": 42}, "unknown shape type"),
        ],
    )
    def test_bad_shapes_name_the_problem(self, shape: object, message: str) -> None:
        with pytest.raises(ValueError, match=message):
            validate_shape(shape, "T")

    def test_none_is_a_no_op(self) -> None:
        # None is only reachable from callers that guard first; it must not
        # raise, so a descriptor that resolves to None is harmless.
        validate_shape(None, "T")

    def test_error_reports_the_path(self) -> None:
        with pytest.raises(ValueError, match=r"T\.a\.bad"):
            validate_shape({"a": {"bad": 42}}, "T")

    def test_union_kind_is_carried_in_content_not_the_container(self) -> None:
        # A tuple of primitive names is a primitive union (`string | number`);
        # a tuple of anything else is a literal union. The validator accepts
        # both and cannot tell them apart — JSON flattens tuples into lists, so
        # both descriptors reach the generator byte-for-byte alike and it must
        # decide by content. Asserting the round trip pins that: a dump which
        # coerced the tuples would destroy the very signal the renderer reads.
        primitive = {"params": {"*": ("string", "number")}}
        literal = {"role": ("base", "overlay")}
        validate_shape(primitive, "T")
        validate_shape(literal, "T")
        assert json.loads(json.dumps(primitive)) == {
            "params": {"*": ["string", "number"]}
        }
        assert json.loads(json.dumps(literal)) == {"role": ["base", "overlay"]}

    def test_mixed_literal_null_union_round_trips(self) -> None:
        # A literal union may mix one literal with null (the method field of
        # the author scale: "equal" or null). null is a primitive name, so the
        # generator renders it unquoted beside the quoted literal — the
        # validator must accept the descriptor and the round trip must not
        # coerce the null into a string.
        mixed = {"method": ("equal", "null")}
        validate_shape(mixed, "T")
        assert json.loads(json.dumps(mixed)) == {"method": ["equal", "null"]}

    def test_shape_without_a_name_has_no_emitting_target(self) -> None:
        with pytest.raises(ValueError, match="requires FieldSpec.name"):
            FieldSpec(shape={"a": "string"})
