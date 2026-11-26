"""Browser tests for the LayerControl drag indicator (one attribute, one state).

Every assertion reads computed style from the real page: the contract is visual,
so a jsdom class check is not enough. One geometric language runs through the
whole gesture — an accent line on the edge where the layer will land:

* source  — the carried row: dimmed for the whole gesture, one pickup pulse;
* before/after — a breathing 2px line on the row edge the layer lands against,
  so dragging up and dragging down over the same gap draw the same picture;
* join    — both edges of the target row light, on a 4% wash, chevron dipping;
* refuse  — no geometry at all: the absence of the line is the refusal, the
  pointer turns to no-drop and the hint line says why.

Rows are addressed by DOM position among root layer rows (layers[i]): the
fixture's GeoJson layers render with an empty title, so ids are hashes.
"""

from __future__ import annotations

import folium
from conftest import _js, load_geojson, make_browser_page

from foliplus import LayerControl


def _page(browser, tmp_path):
    """A map with two folders and four root overlay layers (root rows: 0..3)."""
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


def _act(page, **arg):
    """Start (and optionally land) a synthetic drag through the snippet."""
    page.evaluate(_js("LayerControl/drag_indicator"), arg)


def _read(page):
    """The computed snapshot of every row after the last action."""
    return page.evaluate(_js("LayerControl/drag_indicator"), {"action": "read"})


def _by_state(snapshot, state):
    """Rows carrying one drop state, in DOM order."""
    return [frame for frame in snapshot["frames"] if frame["state"] == state]


def _only(snapshot, state):
    """The single row carrying a state; fails loudly when there are more."""
    frames = _by_state(snapshot, state)
    assert len(frames) == 1, f"expected exactly one {state} row, got {frames}"
    return frames[0]


def _alpha(value):
    """The alpha of a computed colour string, whatever syntax it uses."""
    if value.startswith("color("):
        return float(value.rsplit("/", 1)[1].strip().rstrip(")"))
    if "rgba(" in value:
        return float(value.rsplit(",", 1)[1].strip().rstrip(")"))
    return 0.0 if value == "transparent" else 1.0


class TestDragIndicatorBrowser:
    """Pickup, gap lines, join and refusal — one indicator per gesture."""

    def test_pickup_dimms_once(self, browser, tmp_path):
        """The carried row is dimmed for the gesture and pulses once."""
        page, errors = _page(browser, tmp_path)
        _act(page, action="drag", source=2)
        page.wait_for_timeout(1900)  # let the pickup pulse finish
        snapshot = _read(page)

        source = _only(snapshot, "source")
        assert float(source["opacity"]) == 0.6, (
            f"the carried row must stay dimmed: opacity {source['opacity']}"
        )
        assert source["animationName"] == "foliplus-drag-pickup", (
            f"pickup pulse missing: {source['animationName']}"
        )
        assert source["animationIterationCount"] == "1", "the pickup pulse must run once"
        assert snapshot["lineRows"] == [], f"pickup must not draw a line: {snapshot['lineRows']}"
        assert errors == []

    def test_gap_below_marks_exactly_one_line(self, browser, tmp_path):
        """Dropping below a row lights that row's bottom edge, and only it."""
        page, errors = _page(browser, tmp_path)
        # Row 0 is above row 1, so hovering row 1 puts the gap BELOW it: the
        # gap sits between rows 1 and 2, and the row across it exists (the last
        # root row has a role header below it, and a role boundary has no far
        # row to press).
        _act(page, action="drag", source=0, target=1)
        snapshot = _read(page)

        assert len(snapshot["lineRows"]) == 1, f"one gap, one line: {snapshot['lineRows']}"
        target = _only(snapshot, "after")
        assert snapshot["lineRows"] == [target["key"]]
        pseudo = target["after"]
        assert pseudo["content"] != "none"
        assert pseudo["borderBottomWidth"] == snapshot["tokens"]["line"] == "2px"
        assert pseudo["animationName"] == "foliplus-drag-pulse"
        assert pseudo["animationIterationCount"] == "infinite", (
            "the insertion line breathes for as long as it marks the spot"
        )
        assert target["outlineStyle"] == "none", "an accepted gap draws no outline"
        # The neighbor across the gap is pushed open by a transform, never a
        # re-layout. The pressed row is the one AFTER the gap.
        assert len(snapshot["pushed"]) == 1, f"expected one pressed row: {snapshot['pushed']}"
        assert snapshot["pushed"][0]["push"] == "top"
        assert errors == []

    def test_gap_above_marks_the_same_kind_of_line(self, browser, tmp_path):
        """Dropping above a row mirrors the line; the previous row is pressed."""
        page, errors = _page(browser, tmp_path)
        _act(page, action="drag", source=3, target=2)
        snapshot = _read(page)

        assert len(snapshot["lineRows"]) == 1, f"one gap, one line: {snapshot['lineRows']}"
        target = _only(snapshot, "before")
        assert target["before"]["borderTopWidth"] == "2px"
        assert target["before"]["animationIterationCount"] == "infinite"
        assert len(snapshot["pushed"]) == 1
        assert snapshot["pushed"][0]["push"] == "bottom"
        assert errors == []

    def test_gap_is_symmetric_between_directions(self, browser, tmp_path):
        """The same gap drawn from above and from below is the same picture.

        The gap sits between root rows 2 (above) and 3 (below). Reaching it from
        above draws the line on row 3's TOP edge; reaching it from below draws it
        on row 2's BOTTOM edge. Same slot, same line.
        """
        page, _ = _page(browser, tmp_path)
        _act(page, action="drag", source=3, target=2)
        from_above = [frame for frame in _read(page)["frames"] if frame["hasLine"]][0]

        page, _ = _page(browser, tmp_path)
        _act(page, action="drag", source=0, target=1)
        from_below = [frame for frame in _read(page)["frames"] if frame["hasLine"]][0]

        assert abs(from_above["lineY"] - from_below["lineY"]) <= 1, (
            "the insertion line must mark the same slot from both directions: "
            f"{from_above['lineY']} vs {from_below['lineY']}"
        )
        assert from_above["before"]["borderTopWidth"] == "2px"
        assert from_below["after"]["borderBottomWidth"] == "2px"
        assert from_above["before"]["animationName"] == from_below["after"]["animationName"]

    def test_join_lights_both_edges_of_one_row(self, browser, tmp_path):
        """A join is a row, not a gap: both edges light on one row only."""
        page, errors = _page(browser, tmp_path)
        _act(page, action="drag", source=2, folder="Roads")
        snapshot = _read(page)

        target = _only(snapshot, "join")
        assert target["before"]["borderTopWidth"] == "2px"
        assert target["after"]["borderBottomWidth"] == "2px"
        assert target["before"]["animationName"] == "foliplus-drag-pulse"
        assert target["after"]["animationName"] == "foliplus-drag-pulse"
        assert target["before"]["animationIterationCount"] == "infinite"
        assert snapshot["lineRows"] == [target["key"]], (
            f"a join marks its own row once: {snapshot['lineRows']}"
        )
        # Strikingly light: the wash must not out-weigh the row's own label.
        assert _alpha(target["backgroundColor"]) <= 0.05, (
            f"join wash too strong: {target['backgroundColor']}"
        )
        assert target["chevronAnimation"] == "foliplus-drag-chevron", (
            "the chevron must hint that the row opens"
        )
        assert snapshot["pushed"] == [], "a join is not a gap: nothing is pushed"
        assert errors == []

    def test_refusal_draws_no_geometry(self, browser, tmp_path):
        """A refusal has no line, no ring and no wash — the pointer and hint talk."""
        page, errors = _page(browser, tmp_path)
        # Roads is a folder; Rivers belongs to Water, so hovering it refuses.
        _act(page, action="drag", sourceFolder="Roads", targetKind="member", member=1)
        snapshot = _read(page)

        target = _only(snapshot, "refuse")
        assert snapshot["lineRows"] == [], f"a refusal draws no line: {snapshot['lineRows']}"
        assert target["outlineStyle"] == "none", f"no dashed box: {target['outlineStyle']}"
        assert target["cursor"] == "no-drop", f"the pointer must say no: {target['cursor']}"
        assert target["backgroundColor"] in {"rgba(0, 0, 0, 0)", "transparent"}
        assert snapshot["pushed"] == [], "a refusal presses nothing"
        assert snapshot["hint"], "a refusal must explain itself in one line of text"
        assert errors == []

    def test_folder_drag_uses_the_same_source_rule(self, browser, tmp_path):
        """Folder rows get the same carried-row treatment as layer rows."""
        page, errors = _page(browser, tmp_path)
        before = _read(page)["visibleRows"]
        _act(page, action="drag", sourceFolder="Roads")
        page.wait_for_timeout(1900)
        snapshot = _read(page)

        source = _only(snapshot, "source")
        assert source["key"] == "folder:roads"
        assert float(source["opacity"]) == 0.6
        assert source["animationName"] == "foliplus-drag-pickup"
        assert source["animationIterationCount"] == "1"
        # The block travels as one unit: its members are folded for the gesture.
        assert snapshot["visibleRows"] < before, (
            f"the dragged block's members must fold: {snapshot['visibleRows']} of {before}"
        )
        _act(page, action="dragend")
        assert _read(page)["visibleRows"] == before, "the fold is session-only"
        assert errors == []


class TestDragCommitBrowser:
    """The drop commits the move and then clears every indicator."""

    def test_drop_reorders_and_clears(self, browser, tmp_path):
        """A drop lands the layer and leaves no marked row behind."""
        page, errors = _page(browser, tmp_path)
        before = _read(page)["ids"]
        # Root row 0 lands below root row 2: the pair reverses.
        _act(page, action="drop", source=0, target=2, zone="after")
        after = _read(page)
        assert after["ids"].index(before[0]) > after["ids"].index(before[1]), (
            f"the drop must reorder the rows: {before} -> {after['ids']}"
        )
        assert len(after["marked"]) <= 2, "a commit may flash, never multiply"
        page.wait_for_timeout(600)
        cleared = _read(page)
        assert cleared["marked"] == [], f"indicators must clear after the commit: {cleared['marked']}"
        assert cleared["pushed"] == []
        assert errors == []
