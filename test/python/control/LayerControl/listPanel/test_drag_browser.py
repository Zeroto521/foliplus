"""Browser tests for the LayerControl drag indicator (one attribute, one state).

Every assertion reads computed style from the real page: the redesign's contract
is visual, so a jsdom class check is not enough. The indicator marks the
INSERTION GAP, not the hovered row: before/after paint a pulse line on the row
edge the layer lands against, so dragging up and dragging down over the same gap
produce the same picture. The refusal case is also the regression test for the
old double indicator (solid edge + pulse + dashed outline on one row).

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
    folium.GeoJson(fc, name="Gamma", foliplus={}).add_to(m)
    folium.GeoJson(fc, name="Delta", foliplus={}).add_to(m)
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


def _assert_gap_line(style, edge):
    """The gap line pulses on the row edge, and the edge next to it sinks."""
    pseudo = style[edge]
    assert pseudo["animationName"] == "foliplus-drag-pulse", (
        f"the gap line must pulse: {pseudo['animationName']}"
    )
    assert pseudo["animationIterationCount"] == "1", (
        f"one gesture, one pulse: {pseudo['animationIterationCount']}"
    )
    width = (
        pseudo["borderTopWidth"] if edge == "before" else pseudo["borderBottomWidth"]
    )
    assert width == style["gapLineWidth"], (
        f"the gap line must use the shared token: {width} != {style['gapLineWidth']}"
    )
    offset = pseudo["top"] if edge == "before" else pseudo["bottom"]
    assert offset.startswith("-"), f"the gap line must sit on the edge: {offset}"
    assert "inset" in style["boxShadow"], (
        f"the row edge next to the gap must sink: {style['boxShadow']}"
    )
    assert style["outlineStyle"] == "none", (
        f"an accepted gap must not draw an outline: {style['outlineStyle']}"
    )


class TestDragIndicatorBrowser:
    """Pickup, gap lines, join and refusal — one indicator per row."""

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

    def test_gap_line_pulses_above_the_row(self, browser, tmp_path):
        """Dragging up marks the gap above the hovered row with a pulse line."""
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
        _assert_gap_line(style, "before")
        assert style["animationName"] == "none", (
            f"the pulse belongs to the gap line, not the row: {style['animationName']}"
        )
        assert not errors, f"console errors: {errors}"

    def test_gap_line_pulses_below_the_row(self, browser, tmp_path):
        """Dragging down marks the gap below the hovered row, mirrored."""
        page, errors = _page(browser, tmp_path)
        result = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "hover", "source": 0, "target": 1, "zone": "after"},
        )
        source, target = _marked(result)
        assert len(source) == 1, f"expected the carried row, got {source}"
        assert len(target) == 1, f"expected exactly one drop target, got {target}"
        style = result["target"]
        assert style["state"] == "after"
        _assert_gap_line(style, "after")
        assert not errors, f"console errors: {errors}"

    def test_same_gap_looks_the_same_from_both_directions(self, browser, tmp_path):
        """The symmetry regression: one gap, two drag directions, one picture.

        The gap between layer rows 1 and 2 is reached by dragging row 0 down
        over row 1 (after row 1) and by dragging row 3 up over row 2 (before
        row 2). Both must paint the pulse line at the same y with the same
        computed style — the old indicator pulsed the hovered row instead, so
        the two directions disagreed.
        """
        page, errors = _page(browser, tmp_path)
        down = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "symmetry", "source": 0, "target": 1, "zone": "after"},
        )
        assert down["target"]["state"] == "after", down["target"]["state"]
        page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "reset", "source": 0},
        )
        up = page.evaluate(
            _js("LayerControl/drag_indicator"),
            {"scenario": "symmetry", "source": 3, "target": 2, "zone": "before"},
        )
        assert up["target"]["state"] == "before", up["target"]["state"]

        assert abs(down["lineY"] - up["lineY"]) <= 1, (
            "the same gap must pulse at the same y from both directions: "
            f"{down['lineY']} vs {up['lineY']}"
        )
        down_line = down["target"]["after"]
        up_line = up["target"]["before"]
        assert down_line["animationName"] == up_line["animationName"]
        assert down_line["borderBottomWidth"] == up_line["borderTopWidth"]
        assert down_line["borderBottomColor"] == up_line["borderTopColor"]
        assert "inset" in down["target"]["boxShadow"]
        assert "inset" in up["target"]["boxShadow"]
        assert not errors, f"console errors: {errors}"

    def test_join_pulses_the_whole_row(self, browser, tmp_path):
        """A folder middle is a join: the whole row's inset ring pulses."""
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
        assert style["animationName"] == "foliplus-drag-join-pulse", (
            f"join must pulse the ring: {style['animationName']}"
        )
        assert style["outlineStyle"] == "none", (
            f"join must not draw an outline: {style['outlineStyle']}"
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
        an accepted gap line.
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
        assert style["before"]["borderTopWidth"] == style["gapLineWidth"], (
            f"accepted edge lost its gap line: {style['before']['borderTopWidth']}"
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
        assert leftover == [], f"the drop left an indicator behind: {leftover}"
        assert not errors, f"console errors: {errors}"
