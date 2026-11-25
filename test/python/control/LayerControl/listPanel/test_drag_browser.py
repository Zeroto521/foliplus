"""Browser tests for the LayerControl drag indicator (one attribute, one state).

Every assertion reads computed style from the real page: the redesign's contract
is visual, so a jsdom class check is not enough. The refusal case is also the
regression test for the old double indicator (solid edge + pulse + dashed
outline on one row).

Rows are addressed by their DOM position among layer rows (layers[i]): the
fixture's GeoJson layers render with an empty title, so ids are hashes and the
row text is the count label, not the layer name.
"""

from __future__ import annotations

import folium
from conftest import _js, load_geojson, make_browser_page, snippet_fn

from foliplus import LayerControl


def _page(browser, tmp_path):
    """A map with two folders and four overlay layers (layer rows: 0..3)."""
    fc = load_geojson("LayerControl", "empty_feature_collection")
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    folium.GeoJson(fc, name="Roads", foliplus={"folder": "Roads"}).add_to(m)
    folium.GeoJson(fc, name="Water", foliplus={"folder": "Water"}).add_to(m)
    folium.GeoJson(fc, name="Alpha", foliplus={}).add_to(m)
    folium.GeoJson(fc, name="Beta", foliplus={}).add_to(m)
    LayerControl().add_to(m)
    html = m.get_root().render()
    page, errors = make_browser_page(browser, tmp_path, html, "drag_indicator")
    page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(".foliplus-layer-item", state="attached", timeout=10000)
    page.wait_for_timeout(400)
    return page, errors


def _marked(result):
    """The row states, split into the carried row and the drop target."""
    marked = result["marked"]
    source = [row for row in marked if row["state"] == "source"]
    target = [row for row in marked if row["state"] != "source"]
    return source, target


class TestDragIndicatorBrowser:
    """Pickup, accepted edges, join and refusal — one indicator per row."""

    def test_pickup_pulses_once(self, browser, tmp_path):
        """The carried row is the only row marked, and its pulse runs once."""
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "pickup", "source": 2},
        )
        source, target = _marked(result)
        assert len(source) == 1, f"expected one carried row, got {source}"
        assert target == [], f"pickup must not mark a drop target: {target}"
        style = result["source"]
        assert style["state"] == "source"
        assert style["animationName"] == "foliplus-drag-pulse", (
            f"pickup pulse missing: {style['animationName']}"
        )
        assert style["animationIterationCount"] == "1", (
            "the pickup pulse must run once, not loop: "
            f"{style['animationIterationCount']}"
        )
        assert not errors, f"console errors: {errors}"

    def test_accepted_edge_is_one_solid_line(self, browser, tmp_path):
        """An accepted edge draws a solid border and nothing else."""
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "hover", "source": 3, "target": 2, "zone": "before"},
        )
        source, target = _marked(result)
        assert len(source) == 1, f"expected the carried row, got {source}"
        assert len(target) == 1, f"expected exactly one drop target, got {target}"
        style = result["target"]
        assert style["state"] == "before"
        assert style["borderTopWidth"] != "0px", (
            f"accepted edge lost its border: {style['borderTopWidth']}"
        )
        assert style["borderTopWidth"] == style["expectedBorderWidth"], (
            "the edge must use the shared border token: "
            f"{style['borderTopWidth']} != {style['expectedBorderWidth']}"
        )
        assert style["outlineStyle"] == "none", (
            f"an accepted edge must not draw an outline: {style['outlineStyle']}"
        )
        assert style["animationName"] == "none", (
            f"hover states carry no animation: {style['animationName']}"
        )
        assert not errors, f"console errors: {errors}"

    def test_join_draws_inset_ring(self, browser, tmp_path):
        """A folder middle is a join: inset ring, no outline, no animation."""
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "hover", "source": 2, "folder": "roads", "zone": "into"},
        )
        source, target = _marked(result)
        assert len(source) == 1, f"expected the carried row, got {source}"
        assert len(target) == 1, f"expected exactly one drop target, got {target}"
        style = result["target"]
        assert style["state"] == "join"
        assert "inset" in style["boxShadow"], (
            f"join must draw an inset ring: {style['boxShadow']}"
        )
        assert style["outlineStyle"] == "none", (
            f"join must not draw an outline: {style['outlineStyle']}"
        )
        assert style["animationName"] == "none", (
            f"join carries no animation: {style['animationName']}"
        )
        assert not errors, f"console errors: {errors}"

    def test_refusal_is_dashed_only(self, browser, tmp_path):
        """A refused drop draws a dashed outline and nothing else.

        This is the old double-indicator regression: a position class and the
        blocked class could land on one row, so a solid border, the pulse and a
        dashed outline painted together.
        """
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {
                "scenario": "hover",
                "sourceFolder": "roads",
                "folder": "water",
                "zone": "into",
            },
        )
        source, target = _marked(result)
        assert len(target) == 1, f"expected exactly one refusal row, got {target}"
        style = result["target"]
        assert style["state"] == "refuse"
        assert style["outlineStyle"] == "dashed", (
            f"refusal must draw a dashed outline: {style['outlineStyle']}"
        )
        assert style["borderTopWidth"] == "0px", (
            f"refusal must not keep a solid edge: {style['borderTopWidth']}"
        )
        assert style["animationName"] == "none", (
            f"refusal must not animate: {style['animationName']}"
        )
        assert not errors, f"console errors: {errors}"

    def test_layer_over_folder_edge_is_accepted(self, browser, tmp_path):
        """A layer over a folder row's edge is a legal move, not a refusal.

        The old writer added the position class and the blocked class here; the
        edge places the layer before/after the folder block, so it must read as
        an accepted before/after.
        """
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "hover", "source": 2, "folder": "roads", "zone": "before"},
        )
        source, target = _marked(result)
        assert len(source) == 1, f"expected the carried row, got {source}"
        assert len(target) == 1, f"expected exactly one drop target, got {target}"
        style = result["target"]
        assert style["state"] == "before", (
            f"a folder edge is an accepted position, got {style['state']}"
        )
        assert style["outlineStyle"] == "none", (
            f"accepted edge must not draw the refusal outline: {style['outlineStyle']}"
        )
        assert style["borderTopWidth"] != "0px", (
            f"accepted edge lost its border: {style['borderTopWidth']}"
        )
        assert not errors, f"console errors: {errors}"


class TestDragCommitBrowser:
    """The drop acknowledgement and the gesture teardown."""

    def test_drop_commits_and_clears_every_row(self, browser, tmp_path):
        """A drop moves the layer, shows one beat of state, then clears it."""
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_commit"),
            {"source": 2, "target": 3},
        )
        before, after = result["before"], result["after"]
        dragged = before[2]
        # The dragged layer landed after the row it was dropped on (index 2 -> 3).
        assert after.index(dragged) > after.index(before[3]), (
            f"the drop did not commit the move: {before} -> {after}"
        )
        marked = result["marked"]
        assert len(marked) <= 2, f"the commit flash marked too many rows: {marked}"
        page.wait_for_timeout(400)
        leftover = page.evaluate(f"({snippet_fn('LayerControl/drag_leftover')})()")
        assert leftover == [], (
            f"the commit beat did not clear the indicator: {leftover}"
        )
        assert not errors, f"console errors: {errors}"
