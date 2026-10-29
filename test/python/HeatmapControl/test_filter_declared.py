"""Rendering tests for the declared Heatmap filter (CONFIG.filter).

The declaration is the friendly {field, between} shape; Python normalises it
into the shared filter AST the runtime already reads, so CONF never grows a
second dialect. These tests assert the shipped payload and the two failure
modes: API misuse (a missing field) raises at construction, data-shaped
problems warn and leave the filter undeclared.
"""

from __future__ import annotations

import json

import folium
import pytest

from foliplus import HeatmapControl


def _conf(html: str) -> dict:
    marker = "CONFIG = "
    start = html.index(marker) + len(marker)
    end = html.index(";", start)
    return json.loads(html[start:end])


def _render(**kwargs: object) -> dict:
    m = folium.Map()
    HeatmapControl(**kwargs).add_to(m)
    return _conf(m.get_root().render())


def test_declared_range_reaches_conf_as_an_ast_atom():
    conf = _render(field="score", filter={"field": "score", "between": [10, 50]})

    assert conf["filter"] == {
        "kind": "atom",
        "field": "score",
        "op": "between",
        "range": [10, 50],
    }


def test_undeclared_filter_is_null():
    assert _render()["filter"] is None


def test_equal_bounds_are_a_valid_declaration():
    conf = _render(filter={"field": "score", "between": [7, 7]})

    assert conf["filter"]["range"] == [7, 7]


def test_missing_field_raises_at_construction():
    with pytest.raises(ValueError, match="needs a non-empty 'field'"):
        HeatmapControl(filter={"between": [10, 50]})


def test_non_string_field_raises_at_construction():
    with pytest.raises(ValueError, match="needs a non-empty 'field'"):
        HeatmapControl(filter={"field": 3, "between": [10, 50]})


@pytest.mark.parametrize(
    "declaration",
    [
        {"field": "score"},
        {"field": "score", "between": [10]},
        {"field": "score", "between": [10, 20, 30]},
        {"field": "score", "between": "10-50"},
        {"field": "score", "between": [50, 10]},
        {"field": "score", "between": [10, True]},
        {"field": "score", "between": [10, float("inf")]},
        {"field": "score", "between": [10, 50], "method": "jenks"},
    ],
)
def test_unusable_range_warns_and_leaves_the_filter_undeclared(declaration):
    with pytest.warns(UserWarning, match="HeatmapControl: filter"):
        conf = _render(filter=declaration)

    assert conf["filter"] is None


def test_a_list_is_not_a_heatmap_declaration():
    # The enum arm belongs to MeasureControl; a Heatmap declaration that names
    # values has no panel dimension to render it on.
    with pytest.warns(UserWarning, match="must be a mapping with field/between"):
        conf = _render(filter=["score"])

    assert conf["filter"] is None


def test_a_non_mapping_non_list_warns():
    with pytest.warns(UserWarning, match="must be a mapping with field/between"):
        conf = _render(filter="score")

    assert conf["filter"] is None
