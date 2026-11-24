"""The LayerData FieldSpec: the CONF shape of one collected layer.

``LAYER_DATA_FIELDS`` is the alias table the render path ships as
``CONFIG data[]``; it is data, not behaviour, so these tests pin the shape
it declares (keys, role vocabulary, the optional author facts) rather than
a code path. The table was split out of ``control.py`` in #1319 to meet the
300-code-line criterion; its consumers are the class tests.
"""

from __future__ import annotations

from typing import Annotated, get_args

from foliplus._config_schema import FieldSpec
from foliplus.control.LayerControl._role import LayerRole
from foliplus.control.LayerControl._spec import LAYER_DATA_FIELDS


def _field_of(entry: object) -> FieldSpec:
    """Pull the FieldSpec out of an Annotated[list, FieldSpec(...)]."""
    args = get_args(entry)
    return args[1]


def test_layer_data_fields_has_one_data_key() -> None:
    assert list(LAYER_DATA_FIELDS) == ["data"]


def test_layer_data_shape_declares_the_core_row() -> None:
    shape = _field_of(LAYER_DATA_FIELDS["data"]).shape[0]
    for key in ("name", "id", "role", "show"):
        assert key in shape, key


def test_layer_data_shape_role_uses_the_role_vocabulary() -> None:
    role = _field_of(LAYER_DATA_FIELDS["data"]).shape[0]["role"]
    assert role == get_args(LayerRole), role


def test_layer_data_shape_optional_author_facts_are_present() -> None:
    shape = _field_of(LAYER_DATA_FIELDS["data"]).shape[0]
    assert "fillAuthor" in shape, shape


def test_layer_data_shape_marks_author_paint_optional() -> None:
    shape = _field_of(LAYER_DATA_FIELDS["data"]).shape[0]
    fill_author = shape["fillAuthor"]
    # (schema, "?") means optional.
    assert isinstance(fill_author, tuple) and fill_author[1] == "?", fill_author

