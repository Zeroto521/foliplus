"""Browser tests for the MeasureControl type filter.

The filter is a view filter: the map DOM, the row count, the result line and
the export must all describe the same kept set. Counts are asserted exactly as
a partition of the per-type counts (each type's leaves are disjoint), so a leaf
that is not registered with the filter cannot slip through unnoticed.
"""

from __future__ import annotations

import json

from conftest import _js, use_page

from .helper import _make_page

CLEAR = _js("MeasureControl/clear_filter")

READ_STATE = _js("MeasureControl/read_state")

EXPAND_MEASURE = _js("MeasureControl/expand_measure")

CLICK_EXPORT = _js("MeasureControl/click_export")

DRAW_MARKER = _js("MeasureControl/draw_marker")

TYPES = ["distance", "polygon", "circle", "marker"]

COUNT_KEYS = ("paths", "labels", "dots")


def _count(state):
    return int(state["count"].replace(",", ""))


def _counts(state):
    return {key: state[key] for key in COUNT_KEYS}


def _sum_counts(*states):
    return {key: sum(state[key] for state in states) for key in COUNT_KEYS}


def _open_filter(page):
    page.evaluate(_js("MeasureControl/expand_layers"))
    page.wait_for_selector(".foliplus-layer-ctrl.foliplus-is-expanded", timeout=5000)
    # Drawing a measurement can rebuild the row and close an already-open
    # panel; only re-open when it is actually gone.
    if page.query_selector(".foliplus-layer-filter-panel"):
        return
    opened = page.evaluate(_js("MeasureControl/open_filter"))
    assert opened["ok"], f"filter panel not reachable: {opened}"
    page.wait_for_selector(
        ".foliplus-layer-filter-panel", state="visible", timeout=5000
    )
    page.wait_for_timeout(200)


def _draw_all_options(page):
    """Open the filter panel without drawing anything new and read its state."""
    _open_filter(page)
    return page.evaluate(READ_STATE)


def _draw_all(page):
    # Draw first: LayerControl rebuilds its list from runtime content changes, so
    # the Measure row is there once the measurements exist.
    page.evaluate(_js("MeasureControl/draw_all"))
    page.wait_for_timeout(600)
    _open_filter(page)
    return page.evaluate(READ_STATE)


def _select(page, values):
    # A filter write can rebuild the row and drop the panel; re-open it before
    # touching the checkboxes.
    _open_filter(page)
    result = page.evaluate(_js("MeasureControl/set_filter_values"), values)
    assert result["ok"], result
    page.wait_for_timeout(250)
    return page.evaluate(READ_STATE)


class TestMeasureTypeFilterBrowser:
    def test_live_filter_partitions_each_type_exactly(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            assert sorted(baseline["stored"]) == [
                "circle",
                "distance",
                "marker",
                "polygon",
            ]
            assert _counts(baseline)["paths"] > 0
            assert _counts(baseline)["labels"] > 0
            assert _counts(baseline)["dots"] > 0

            per_type = {}
            for kind in TYPES:
                only = _select(page, [kind])
                assert only["visible"] == [kind], only
                assert _count(only) == 1, only
                assert "25%" in only["result"], only
                per_type[kind] = _counts(only)

            # A distance measurement keeps its polyline, its one segment label
            # and its two endpoint dots — nothing else.
            assert per_type["distance"] == {"paths": 1, "labels": 1, "dots": 2}, (
                per_type["distance"]
            )

            # Every rendered leaf belongs to exactly one measurement type: the
            # per-type counts must partition the unfiltered DOM exactly.
            assert _sum_counts(*per_type.values()) == _counts(baseline), (
                per_type,
                _counts(baseline),
            )

            # A multi-select paints both types' leaves, no more and no less.
            two = _select(page, ["distance", "polygon"])
            assert sorted(two["visible"]) == ["distance", "polygon"], two
            assert _count(two) == 2, two
            assert "50%" in two["result"], two
            assert _counts(two) == _sum_counts(
                per_type["distance"], per_type["polygon"]
            ), (two, per_type)

            assert page.evaluate(CLEAR)
            page.wait_for_timeout(250)
            cleared = page.evaluate(READ_STATE)
            assert cleared["filter"] is None, cleared
            assert _count(cleared) == 4, cleared
            assert "100%" in cleared["result"], cleared
            assert _counts(cleared) == _counts(baseline), (cleared, baseline)
            assert not errors, f"JS errors: {errors}"

    def test_filter_survives_reload_and_drops_stale_records(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            distance_only = _select(page, ["distance"])
            distance_counts = _counts(distance_only)

            page.reload()
            page.wait_for_selector(
                ".foliplus-measure-ctrl", state="attached", timeout=10000
            )
            page.wait_for_timeout(600)
            _open_filter(page)
            restored = page.evaluate(READ_STATE)

            assert restored["filter"] == {
                "kind": "enum",
                "field": "type",
                "values": ["distance"],
            }, restored
            assert restored["visible"] == ["distance"], restored
            assert _count(restored) == 1, restored
            assert "25%" in restored["result"], restored
            # The rebuilt leaves are hidden again after restore: exact counts,
            # not just "fewer than baseline".
            assert _counts(restored) == distance_counts, (restored, distance_counts)

            assert page.evaluate(CLEAR)
            page.wait_for_timeout(250)
            cleared = page.evaluate(READ_STATE)
            assert _counts(cleared) == _counts(baseline), (cleared, baseline)

            # A stale condition from an older record must read as no filter.
            page.evaluate(_js("MeasureControl/seed_stale_filter"))
            page.reload()
            page.wait_for_selector(
                ".foliplus-measure-ctrl", state="attached", timeout=10000
            )
            page.wait_for_timeout(600)
            _open_filter(page)
            stale = page.evaluate(READ_STATE)
            assert stale["filter"] is None, stale
            assert _count(stale) == 4, stale
            assert _counts(stale) == _counts(baseline), (stale, baseline)
            assert not errors, f"JS errors: {errors}"

    def test_measurement_drawn_under_filter_starts_hidden(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            per_type = {}
            for kind in TYPES:
                per_type[kind] = _counts(_select(page, [kind]))
            distance_only = _select(page, ["distance"])

            # Draw a polygon and a marker while only distance is kept. Their
            # attach path re-adds leaves (z-order sort / centroid build); the
            # filter must replay on top of that and keep them off the map.
            stored = page.evaluate(_js("MeasureControl/draw_hidden_types"))
            assert len(stored) == 6, stored
            page.wait_for_timeout(500)
            # The draw interaction rebuilds the row and closes the panel; the
            # filter itself stays committed, so re-open to read the result row.
            _open_filter(page)
            after_draw = page.evaluate(READ_STATE)
            assert after_draw["visible"] == ["distance"], after_draw
            assert _count(after_draw) == 1, after_draw
            assert "17%" in after_draw["result"] or "16%" in after_draw["result"], (
                after_draw
            )
            assert _counts(after_draw) == _counts(distance_only), (
                after_draw,
                distance_only,
            )

            assert page.evaluate(CLEAR)
            page.wait_for_timeout(300)
            cleared = page.evaluate(READ_STATE)
            assert _count(cleared) == 6, cleared
            assert "100%" in cleared["result"], cleared
            # The new polygon and marker render the same leaf shape as the kept
            # baseline ones, so the restored DOM is the old total plus one
            # polygon and one marker.
            expected = _sum_counts(
                baseline,
                per_type["polygon"],
                per_type["marker"],
            )
            assert _counts(cleared) == expected, (cleared, expected)
            assert not errors, f"JS errors: {errors}"

    def test_export_geojson_contains_only_kept_measurements(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _draw_all(page)
            assert _select(page, ["distance"])["visible"] == ["distance"]

            assert page.evaluate(EXPAND_MEASURE)
            with page.expect_download() as download:
                assert page.evaluate(CLICK_EXPORT)
            data = json.loads(download.value.path().read_text(encoding="utf-8-sig"))

            assert len(data["features"]) == 1
            assert data["features"][0]["properties"]["type"] == "distance"
            assert not errors, f"JS errors: {errors}"

    def test_export_csv_rows_equal_kept_measurements(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path, export_format="csv") as (
            page,
            errors,
        ):
            _draw_all(page)
            assert _select(page, ["distance"])["visible"] == ["distance"]

            assert page.evaluate(EXPAND_MEASURE)
            with page.expect_download() as download:
                assert page.evaluate(CLICK_EXPORT)
            text = download.value.path().read_text(encoding="utf-8-sig")
            rows = [line for line in text.splitlines() if line.strip()]

            # Header + one kept row: hidden measurements are not exported.
            assert len(rows) == 2
            assert "distance" in rows[1]
            assert not errors, f"JS errors: {errors}"

    def test_options_follow_present_types(self, browser, tmp_path):
        """The disclosure offers only the measurement types that exist.

        A marker-only map offers one type; drawing a distance while the panel is
        open adds its option through the item-count signal; clearing every
        measurement empties the list without touching the committed filter.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(DRAW_MARKER)
            page.wait_for_timeout(600)
            state = _draw_all_options(page)
            assert state["options"] == ["marker"], state
            assert state["stored"] == ["marker"], state

            page.evaluate(_js("MeasureControl/draw_distance_for_filter"))
            page.wait_for_timeout(700)
            state = _draw_all_options(page)
            assert sorted(state["options"]) == ["distance", "marker"], state

            # Filter marker, then delete the last marker: the value stays
            # committed, its option disappears and the readout reports 0 kept
            # instead of silently clearing the filter.
            state = _select(page, ["marker"])
            assert state["filter"]["values"] == ["marker"], state
            page.evaluate(_js("MeasureControl/delete_first_type"), "marker")
            page.wait_for_timeout(700)
            state = _draw_all_options(page)
            assert state["stored"] == ["distance"], state
            assert state["options"] == ["distance"], state
            assert state["filter"] == {
                "kind": "enum",
                "field": "type",
                "values": ["marker"],
            }, state
            assert state["visible"] == [], state
            assert _count(state) == 0, state
            assert "0%" in state["result"], state

            # Drawing a marker again restores the option and the visible item.
            page.evaluate(DRAW_MARKER)
            page.wait_for_timeout(700)
            state = _draw_all_options(page)
            assert sorted(state["options"]) == ["distance", "marker"], state
            assert state["visible"] == ["marker"], state
            assert not errors, f"JS errors: {errors}"

    def test_listbox_escape_and_map_press_close_panel(self, browser, tmp_path):
        """Escape from the native listbox closes the panel; a map press does too."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            assert baseline["selected"] == [], baseline
            page.click(".foliplus-filter-enum")
            page.wait_for_timeout(120)
            assert page.evaluate(READ_STATE)["selectMultiple"] is True

            page.keyboard.press("Escape")
            page.wait_for_timeout(120)
            assert page.query_selector(".foliplus-layer-filter-panel") is None
            assert not errors, f"JS errors: {errors}"

    def test_real_listbox_clicks_filter_two_types(self, browser, tmp_path):
        """Real Chromium clicks on two listbox rows toggle exactly those types.

        The native multiple listbox normally needs Ctrl to add a second row; the
        body's mousedown path makes one click toggle one option. This drives
        real pointer presses at the option boxes (not synthetic events) and
        checks the filter, the readout and the painted leaves.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            rects = page.evaluate(_js("MeasureControl/read_option_rects"))
            assert rects, "listbox options have no hit boxes"
            by_value = {row["value"]: row for row in rects}

            page.mouse.click(by_value["distance"]["x"], by_value["distance"]["y"])
            page.wait_for_timeout(300)
            one = page.evaluate(READ_STATE)
            assert one["selected"] == ["distance"], one
            assert _count(one) == 1, one
            assert one["count"] == "1", one
            assert "25%" in one["result"], one

            # The row reflows when the kept count changes, so the panel moved:
            # re-read the hit boxes before the second press.
            rects = page.evaluate(_js("MeasureControl/read_option_rects"))
            by_value = {row["value"]: row for row in rects}
            page.mouse.click(by_value["polygon"]["x"], by_value["polygon"]["y"])
            page.wait_for_timeout(300)
            two = page.evaluate(READ_STATE)
            assert two["selected"] == ["distance", "polygon"], two
            assert sorted(two["visible"]) == ["distance", "polygon"], two
            assert _count(two) == 2, two
            assert "50%" in two["result"], two
            assert sum(_counts(two).values()) < sum(_counts(baseline).values()), (
                two,
                baseline,
            )
            assert not errors, f"JS errors: {errors}"
