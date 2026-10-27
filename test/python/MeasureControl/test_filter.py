"""Browser tests for the MeasureControl type filter.

The filter is a view filter: the map DOM, the row count, the result line and
the export must all describe the same kept set. Counts are asserted exactly as
a partition of the per-type counts (each type's leaves are disjoint), so a leaf
that is not registered with the filter cannot slip through unnoticed.
"""

from __future__ import annotations

import json

from conftest import use_page

from .helper import _make_page

DRAW_ALL = r"""
() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const click = p => map.fire("click", { latlng: L.latLng(p[0], p[1]) });
  mm.setMode("distance");
  click([26.08, 119.30]); click([26.09, 119.31]);
  map.fire("contextmenu", { latlng: L.latLng(26.09, 119.31) });
  mm.setMode("polygon");
  click([26.07, 119.30]); click([26.08, 119.31]); click([26.06, 119.32]);
  map.fire("contextmenu", { latlng: L.latLng(26.06, 119.32) });
  mm.setMode("circle");
  click([26.05, 119.30]); click([26.05, 119.315]);
  mm.setMode("marker");
  click([26.04, 119.30]);
  mm.setMode(null);
  return true;
}
"""

DRAW_HIDDEN_TYPES = r"""
() => {
  const mm = window.__measureManager;
  const map = window.__map;
  const click = p => map.fire("click", { latlng: L.latLng(p[0], p[1]) });
  mm.setMode("polygon");
  click([26.03, 119.30]); click([26.04, 119.31]); click([26.02, 119.32]);
  map.fire("contextmenu", { latlng: L.latLng(26.02, 119.32) });
  mm.setMode("marker");
  click([26.01, 119.30]);
  mm.setMode(null);
  return mm.measurements.map(m => m.type);
}
"""

OPEN_FILTER = r"""
() => {
  const row = document.querySelector('.foliplus-layer-item[data-layer-id="foliplus_measure"]');
  if (!row) return { ok: false, reason: "no-row" };
  row.querySelector(".foliplus-layer-more-btn").click();
  const item = row.querySelector('.foliplus-layer-more-menu li[data-action="filter-layer"]');
  if (!item) return { ok: false, reason: "no-filter-entry" };
  item.click();
  return { ok: true };
}
"""

SET_VALUES = r"""
(values) => {
  const trigger = document.querySelector(".foliplus-filter-enum-trigger");
  if (!trigger) return { ok: false, reason: "no-trigger" };
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  for (const option of document.querySelectorAll(
    ".foliplus-filter-enum-option",
  )) {
    const want = values.includes(option.dataset.value);
    if ((option.getAttribute("aria-selected") === "true") !== want) option.click();
  }
  if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
  return { ok: true };
}
"""

CLEAR = r"""
() => {
  const clear = document.querySelector(".foliplus-filter-clear");
  if (!clear || clear.disabled) return false;
  clear.click();
  return true;
}
"""

READ_STATE = r"""
() => {
  const mm = window.__measureManager;
  const row = document.querySelector(
    '.foliplus-layer-item[data-layer-id="foliplus_measure"]');
  const count = row ? row.querySelector(".foliplus-layer-count") : null;
  const result = document.querySelector(".foliplus-filter-result");
  return {
    stored: mm.measurements.map(m => m.type),
    visible: mm.visibleMeasurements().map(m => m.type),
    filter: mm.measureFilter || null,
    count: count ? count.textContent.trim() : null,
    result: result ? result.textContent : null,
    paths: document.querySelectorAll(".foliplus-measure-path").length,
    labels: document.querySelectorAll(".foliplus-measure-label").length,
    dots: document.querySelectorAll(
      ".foliplus-measure-node, .foliplus-dot").length,
  };
}
"""

EXPAND_LAYERS = r"""
() => {
  const ctrl = document.querySelector(".foliplus-layer-ctrl");
  if (!ctrl.classList.contains("foliplus-is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  return true;
}
"""

EXPAND_MEASURE = r"""
() => {
  const ctrl = document.querySelector(".foliplus-measure-ctrl");
  if (!ctrl.classList.contains("foliplus-is-expanded")) {
    ctrl.querySelector(".foliplus-toggle-btn").click();
  }
  return true;
}
"""

CLICK_EXPORT = r"""
() => {
  const btn = document.querySelector(
    ".foliplus-measure-ctrl .foliplus-tool-btn:not([data-mode])");
  if (!btn) return false;
  btn.click();
  return true;
}
"""

TYPES = ["distance", "polygon", "circle", "marker"]

COUNT_KEYS = ("paths", "labels", "dots")


def _count(state):
    return int(state["count"].replace(",", ""))


def _counts(state):
    return {key: state[key] for key in COUNT_KEYS}


def _sum_counts(*states):
    return {key: sum(state[key] for state in states) for key in COUNT_KEYS}


def _open_filter(page):
    page.evaluate(EXPAND_LAYERS)
    page.wait_for_selector(".foliplus-layer-ctrl.foliplus-is-expanded", timeout=5000)
    # Drawing a measurement can rebuild the row and close an already-open
    # panel; only re-open when it is actually gone.
    if page.query_selector(".foliplus-layer-filter-panel"):
        return
    opened = page.evaluate(OPEN_FILTER)
    assert opened["ok"], f"filter panel not reachable: {opened}"
    page.wait_for_selector(
        ".foliplus-layer-filter-panel", state="visible", timeout=5000
    )
    page.wait_for_timeout(200)


def _draw_all(page):
    # Draw first: LayerControl rebuilds its list from runtime content changes, so
    # the Measure row is there once the measurements exist.
    page.evaluate(DRAW_ALL)
    page.wait_for_timeout(600)
    _open_filter(page)
    return page.evaluate(READ_STATE)


def _select(page, values):
    result = page.evaluate(SET_VALUES, values)
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
            page.evaluate(
                """() => {
                  const mm = window.__measureManager;
                  localStorage.setItem(mm.filterStorageKey, JSON.stringify({
                    version: 1,
                    filter: { kind: "enum", field: "type", values: ["bogus"] },
                  }));
                }"""
            )
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
            stored = page.evaluate(DRAW_HIDDEN_TYPES)
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
