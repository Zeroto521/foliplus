"""The declared Heatmap filter: shipped payload, first frame, and its docs.

The declaration is the friendly {min, max} shape, bound to the aggregation
field (field=); Python normalises it into the shared filter AST the runtime
already reads, so CONF never grows a second dialect. These tests assert the
shipped payload and the two failure modes: API misuse (a field key inside the
filter, a range with no bound field, or a list of values — the list form that
belongs to MeasureControl) raises at construction, data-shaped problems warn
and leave the filter undeclared.

The browser half drives a real page: the h3 stub puts every point in one cell,
so the aggregated cell value is the evidence — with agg="sum" the declared
range must leave only the kept points in the sum, and a page without a
declaration must sum all of them.

The class docstring is the author-facing contract, so the last block pins the
*documented promises* — the mapping shape bound to the aggregation field, the
API-misuse ``ValueError``, the warn-once / treat-as-undeclared rule for
data-shaped problems, and the difference between the filter row's Clear and the
factory Reset. Assertions are semantic invariants (section presence, key names,
rule wording), never the exact prose.
"""

from __future__ import annotations

import inspect
import json
from fractions import Fraction
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    make_browser_page,
    point_feature,
    use_page,
)

from foliplus import HeatmapControl

from .helper import _expose_ctrl, _stub_html


def _class_doc() -> str:
    """The class docstring is the single contract surface for the declaration."""
    doc = inspect.getdoc(HeatmapControl)
    assert doc is not None, "HeatmapControl must carry a class docstring"
    return doc


# ── docstring contract ──
_DOC = _class_doc()

# The Notes section (the last major section) holds the declaration tables
# and the resolution rules; anchor on the exact section header.
_NOTES = _DOC.split("Notes\n-----", 1)[1]

# Grid-table rows wrap mid-sentence and carry cell borders. Collapse both so a
# rule can be asserted as one phrase regardless of where the column broke.
_FLAT = " ".join(_NOTES.replace("|", " ").split())

# ── browser: the declared seed ──
_READ = _js("HeatmapControl/read_manager_declared_filter")
_PICK = _js("HeatmapControl/pick_layer")

# One point layer, three points carrying val = 26.07 / 26.08 / 26.09.
_ALL = 26.07 + 26.08 + 26.09
_DECLARED = {"kind": "atom", "field": "val", "op": "between", "range": [26.075, 26.085]}
_KEPT = 26.08


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


def test_an_enum_declaration_raises_and_points_at_measure_control():
    # The list form belongs to MeasureControl; a Heatmap declaration that names
    # values has no panel dimension to render it on. This is the wrong control,
    # not a data-shaped problem, so it raises where the author can fix it.
    with pytest.raises(ValueError, match="enum filters belong to MeasureControl"):
        HeatmapControl(agg="sum", field="score", filter=["score"])


def test_a_range_declaration_is_still_accepted_after_the_enum_guard():
    conf = _render(agg="sum", field="score", filter={"min": 10, "max": 50})

    assert conf["filter"] == {
        "kind": "atom",
        "field": "score",
        "op": "between",
        "range": [10, 50],
    }


def test_a_non_mapping_scalar_warns():
    with pytest.warns(UserWarning, match="must be a mapping with min and max"):
        conf = _render(agg="sum", field="score", filter="score")

    assert conf["filter"] is None


@pytest.mark.parametrize(
    "declaration",
    [
        {"min": 50, "max": 10},  # warned from range_atom
        "score",  # warned from normalize_declared_filter itself
    ],
)
def test_a_warning_points_at_the_calling_cell(declaration):
    # The declaration is written in the user's notebook cell, so the warning
    # has to name that file - a warning pointing inside the library is not
    # actionable where the author can see it.
    with pytest.warns(UserWarning) as record:
        _render(agg="sum", field="score", filter=declaration)

    assert Path(record[0].filename).resolve() == Path(__file__).resolve()


def _open_panel(page):
    """Expand the panel and wait for the control's first scan.

    The heatmap's DOM (and its first scan + render) is built when the control
    is added to the map; expanding only makes the panel visible, so the probe
    expands it first and reads the same "open page" state a user sees.
    """
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    heatmap_ready(page)


def _wait_for_frame(page):
    page.wait_for_function(
        "() => window.__heatmapCtrl.mgr.cachedFeatures !== null", timeout=10000
    )


def _make_page(
    browser,
    tmp_path,
    *,
    layers=(("Points", (26.07, 26.08, 26.09)),),
    wait_for_render=True,
    **ctrl_kwargs,
):
    """A page with the given point layers and a HeatmapControl, expanded.

    wait_for_render waits for the first aggregated frame; a page with more than
    one source has nothing selected yet, so the probe waits for the pick.
    """
    from foliplus import HeatmapControl, LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for name, lats in layers:
        fg = folium.FeatureGroup(name=name, show=True)
        for lat in lats:
            gj = json.dumps(
                feature_collection(point_feature(119.30, lat, {"val": lat}))
            )
            folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)

    LayerControl().add_to(m)
    HeatmapControl(**ctrl_kwargs).add_to(m)

    html = _expose_ctrl(_stub_html(m.get_root().render()))
    page, errors = make_browser_page(browser, tmp_path, html, "heatmap_filter")
    _open_panel(page)
    if wait_for_render:
        _wait_for_frame(page)
    return page, errors


def _make_two_layer_page(browser, tmp_path, **ctrl_kwargs):
    """Two point layers and no declared starting layer: the source is picked by
    hand, which is the path the dropdown's onchange owns."""
    return _make_page(
        browser,
        tmp_path,
        layers=(("Alpha", (26.07,)), ("Beta", (26.07, 26.08, 26.09))),
        wait_for_render=False,
        **ctrl_kwargs,
    )


class TestDeclaredHeatmapFilterBrowser:
    def test_declared_range_filters_the_first_render(self, browser, tmp_path):
        with use_page(
            _make_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"min": 26.075, "max": 26.085},
        ) as (page, errors):
            state = page.evaluate(_READ)

            assert state["filter"] == _DECLARED, state
            # A declaration is not a user choice: the slot stays unowned.
            assert state["touched"] is False, state
            assert len(state["values"]) == 1, state
            assert state["values"][0] == pytest.approx(_KEPT), state
            assert not errors, f"JS errors: {errors}"

    def test_picking_a_source_by_hand_filters_the_first_frame(self, browser, tmp_path):
        """The declaration covers a source the user picks, not only the declared
        / auto-selected / restored ones: the first frame after the pick is
        filtered, and a reload agrees with it."""
        with use_page(
            _make_two_layer_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"min": 26.075, "max": 26.085},
        ) as (page, errors):
            picked = page.evaluate(_PICK, "Beta")
            assert picked["ok"], picked
            _wait_for_frame(page)
            state = page.evaluate(_READ)

            assert state["filter"] == _DECLARED, state
            assert state["touched"] is False, state
            assert len(state["values"]) == 1, state
            assert state["values"][0] == pytest.approx(_KEPT), state

            # The restored record must reproduce the first frame. A seed that
            # only ran on reload would disagree here.
            page.reload()
            _open_panel(page)
            _wait_for_frame(page)
            reloaded = page.evaluate(_READ)

            assert reloaded["filter"] == state["filter"], (state, reloaded)
            assert reloaded["values"] == state["values"], (state, reloaded)
            assert not errors, f"JS errors: {errors}"

    def test_without_a_declaration_every_point_is_counted(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path, agg="sum", field="val") as (
            page,
            errors,
        ):
            state = page.evaluate(_READ)

            assert state["filter"] is None, state
            assert state["values"][0] == pytest.approx(_ALL), state
            assert not errors, f"JS errors: {errors}"

    def test_an_unusable_declaration_leaves_every_point_counted(
        self, browser, tmp_path
    ):
        # Outside the extent: the seed reports it and starts unfiltered —
        # clamping would collapse it onto one bound and hide the data, and
        # "declared" must never mean "filtered to empty".
        with use_page(
            _make_page,
            browser,
            tmp_path,
            agg="sum",
            field="val",
            filter={"min": 1000, "max": 2000},
        ) as (page, errors):
            state = page.evaluate(_READ)

            assert state["filter"] is None, state
            assert state["values"][0] == pytest.approx(_ALL), state
            assert not errors, f"JS errors: {errors}"


def test_docstring_documents_the_min_max_mapping_form() -> None:
    """The range declaration is documented as a mapping with min and max."""
    assert "``filter`` is a mapping with ``min`` and ``max``" in _DOC
    assert "``min`` / ``max``" in _FLAT
    assert "``number``" in _FLAT
    # The range is bound to the aggregation field, not a free-standing window.
    assert "``field=``" in _FLAT


def test_docstring_declares_api_misuse_raises_valueerror() -> None:
    """A filter key, no bound field, or the other branch raises at the cell."""
    assert "``ValueError``" in _FLAT
    assert "``field`` key inside ``filter``" in _FLAT
    assert '``agg="count"``' in _FLAT
    assert "a list of value names" in _FLAT


def test_docstring_declares_data_shaped_problems_warn_once() -> None:
    """An extent failure warns once and is treated as undeclared."""
    assert "Data-shaped problem" in _FLAT
    assert "Reported once" in _FLAT
    assert "treated as" in _FLAT.lower()
    assert "undeclared" in _FLAT.lower()
    # The failure never turns into a filter that hides every feature.
    assert "never silently filtered to" in _FLAT
    assert "empty" in _FLAT


def test_docstring_separates_filter_row_clear_from_factory_reset() -> None:
    """The filter row's Clear keeps the clear; the panel's Clear re-seeds."""
    assert "The filter row's Clear" in _FLAT
    assert "does not come back" in _FLAT
    assert "Factory Reset" in _FLAT
    assert "re-seeds the declaration" in _FLAT
    # The factory Reset here is the panel's own Clear button.
    assert "the panel's Clear" in _FLAT


def test_docstring_calls_the_declaration_a_starting_condition() -> None:
    """User writes win; the declaration only seeds the first open."""
    assert "starting condition only" in _FLAT
    assert "Wins from then on" in _FLAT
