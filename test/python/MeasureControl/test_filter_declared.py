"""Rendering tests for the declared Measure filter (CONFIG.filter).

The friendly declaration is a list of measurement-type names; Python
normalises it into the shared enum AST. The type domain itself lives in the
runtime (MeasureControl/const.ts), so Python checks the shape only and the
runtime drops names it does not know - which is why an unknown name still
reaches CONF here.
"""

from __future__ import annotations

import json

import folium
import pytest

from foliplus import MeasureControl


def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])


def _render(**kwargs: object) -> dict:
    m = folium.Map()
    MeasureControl(**kwargs).add_to(m)
    return _conf(m.get_root().render())


def test_declared_types_reach_conf_as_an_enum_ast_atom():
    conf = _render(filter=["distance", "polygon"])

    assert conf["filter"] == {
        "kind": "enum",
        "field": "type",
        "values": ["distance", "polygon"],
    }


def test_duplicates_are_dropped_in_first_seen_order():
    conf = _render(filter=["polygon", "distance", "polygon"])

    assert conf["filter"]["values"] == ["polygon", "distance"]


def test_undeclared_filter_is_null():
    assert _render()["filter"] is None


def test_empty_list_warns_and_leaves_the_filter_undeclared():
    # An empty selection means "no filter", so an empty declaration is a
    # statement that means nothing: report it rather than emitting a filter
    # that would read as a user choice.
    with pytest.warns(UserWarning, match="empty list"):
        conf = _render(filter=[])

    assert conf["filter"] is None


@pytest.mark.parametrize("declaration", [["distance", 3], ["distance", ""], [None]])
def test_non_string_values_warn_and_leave_the_filter_undeclared(declaration):
    with pytest.warns(UserWarning, match="non-empty strings"):
        conf = _render(filter=declaration)

    assert conf["filter"] is None


def test_a_mapping_is_not_a_measure_declaration():
    # The range arm belongs to HeatmapControl; Measure's panel dimension is the
    # measurement type, so a field/between mapping has no row to render it on.
    with pytest.warns(UserWarning, match="must be a list of value names"):
        conf = _render(filter={"field": "type", "between": [1, 2]})

    assert conf["filter"] is None
