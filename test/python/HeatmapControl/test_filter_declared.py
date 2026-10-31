"""Rendering tests for the declared Heatmap filter (CONFIG.filter).

The declaration is the friendly {min, max} shape, bound to the aggregation
field (field=); Python normalises it into the shared filter AST the runtime
already reads, so CONF never grows a second dialect. These tests assert the
shipped payload and the two failure modes: API misuse (a field key inside the
filter, or a range with no bound field) raises at construction, data-shaped
problems warn and leave the filter undeclared.
"""

from __future__ import annotations

import json
from fractions import Fraction
from pathlib import Path

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
    conf = _render(agg="sum", field="score", filter={"min": 10, "max": 50})

    assert conf["filter"] == {
        "kind": "atom",
        "field": "score",
        "op": "between",
        "range": [10, 50],
    }


def test_non_json_numbers_are_normalised_before_conf_serialisation():
    # numpy and pandas scalars pass the numbers.Real check but not json.dumps,
    # and {"min": df["pop"].min(), "max": df["pop"].max()} is the natural way to
    # write a declaration from a frame. Fraction is the stdlib stand-in for
    # that shape: Real, and unknown to json - so this renders or it raises.
    declaration = {"min": Fraction(1, 2), "max": Fraction(3, 4)}

    conf = _render(agg="sum", field="score", filter=declaration)

    assert conf["filter"]["range"] == [0.5, 0.75]
    assert [type(bound) for bound in conf["filter"]["range"]] == [float, float]


def test_undeclared_filter_is_null():
    assert _render()["filter"] is None


def test_equal_bounds_are_a_valid_declaration():
    conf = _render(agg="sum", field="score", filter={"min": 7, "max": 7})

    assert conf["filter"]["range"] == [7, 7]


def test_a_field_key_inside_filter_raises_at_construction():
    # The range is bound to the aggregation field (field=), so a field key
    # inside the declaration is API misuse, not a second way to name it.
    with pytest.raises(ValueError, match="drop 'field' from filter="):
        HeatmapControl(field="score", filter={"field": "score", "min": 10, "max": 50})


def test_a_range_with_no_bound_field_raises_at_construction():
    # A filter range needs the aggregation field it binds to: no field= and
    # agg="count" (the default) leave no field to filter on.
    with pytest.raises(ValueError, match="needs the aggregation field it binds to"):
        HeatmapControl(filter={"min": 10, "max": 50})
    with pytest.raises(ValueError, match="needs the aggregation field it binds to"):
        HeatmapControl(agg="count", field="score", filter={"min": 10, "max": 50})


def test_an_inverted_range_with_no_field_still_raises():
    # P2-1: the bound-field check runs before the min/max validation, so an
    # inverted range (a data-shaped problem) must not mask the API misuse of
    # declaring a range with nothing to bind it to.
    with pytest.raises(ValueError, match="needs the aggregation field it binds to"):
        HeatmapControl(filter={"min": 50, "max": 10})


@pytest.mark.parametrize(
    "declaration",
    [
        {"min": 10},
        {"min": 10, "max": 20, "between": [1, 2]},  # between is now an unknown key
        {"min": "10-50", "max": 60},
        {"min": 50, "max": 10},
        {"min": 10, "max": True},
        {"min": 10, "max": float("inf")},
        {"min": 10, "max": 50, "method": "jenks"},
    ],
)
def test_unusable_range_warns_and_leaves_the_filter_undeclared(declaration):
    with pytest.warns(UserWarning, match="HeatmapControl: filter"):
        conf = _render(agg="sum", field="score", filter=declaration)

    assert conf["filter"] is None


def test_a_range_missing_a_bound_warns_and_leaves_the_filter_undeclared():
    # Both keys are required: a declaration with only one bound names no
    # range, so it is data-shaped and warns instead of raising.
    with pytest.warns(UserWarning, match="needs both 'min' and 'max'"):
        conf = _render(agg="sum", field="score", filter={"min": 10})

    assert conf["filter"] is None


def test_a_between_key_is_now_unknown_and_warns():
    # The shape moved to {min, max}; a legacy between key is no longer a
    # synonym — it is an unknown key and the declaration is ignored.
    with pytest.warns(UserWarning, match="has unknown key"):
        conf = _render(agg="sum", field="score", filter={"between": [10, 50]})

    assert conf["filter"] is None


def test_a_list_is_not_a_heatmap_declaration():
    # The enum arm belongs to MeasureControl; a Heatmap declaration that names
    # values has no panel dimension to render it on.
    with pytest.warns(UserWarning, match="must be a mapping with min and max"):
        conf = _render(agg="sum", field="score", filter=["score"])

    assert conf["filter"] is None


def test_a_non_mapping_non_list_warns():
    with pytest.warns(UserWarning, match="must be a mapping with min and max"):
        conf = _render(agg="sum", field="score", filter="score")

    assert conf["filter"] is None


@pytest.mark.parametrize(
    "declaration",
    [
        {"min": 50, "max": 10},  # warned from _range_atom
        ["score"],  # warned from normalize_declared_filter itself
    ],
)
def test_a_warning_points_at_the_calling_cell(declaration):
    # The declaration is written in the user's notebook cell, so the warning
    # has to name that file - a warning pointing inside the library is not
    # actionable where the author can see it.
    with pytest.warns(UserWarning) as record:
        _render(agg="sum", field="score", filter=declaration)

    assert Path(record[0].filename).resolve() == Path(__file__).resolve()
