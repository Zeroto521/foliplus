"""Browser tests for the MeasureControl type filter.

Draws one measurement per type, then drives the shared filter panel through the
component's LayerControl row and checks that the map, the row count, the result
line and the export all agree.
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

PICK = r"""
(values) => {
  const trigger = document.querySelector(".foliplus-filter-enum-trigger");
  if (!trigger) return { ok: false };
  if (trigger.getAttribute("aria-expanded") !== "true") trigger.click();
  for (const v of values) {
    const opt = document.querySelector(
      '.foliplus-filter-enum-option[data-value="' + v + '"]');
    if (!opt) return { ok: false, missing: v };
    if (opt.getAttribute("aria-selected") !== "true") opt.click();
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


def _count(state):
    return int(state["count"].replace(",", ""))


def _open_filter(page):
    page.wait_for_timeout(600)
    page.evaluate(EXPAND_LAYERS)
    page.wait_for_selector(".foliplus-layer-ctrl.foliplus-is-expanded", timeout=5000)
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


class TestMeasureTypeFilterBrowser:
    def test_filter_updates_map_row_count_result_and_clear(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            assert sorted(baseline["stored"]) == [
                "circle",
                "distance",
                "marker",
                "polygon",
            ]
            assert baseline["filter"] is None
            assert _count(baseline) == 4
            assert "100%" in baseline["result"]
            assert baseline["paths"] > 0 and baseline["labels"] > 0

            picked = page.evaluate(PICK, ["distance"])
            assert picked["ok"], picked
            page.wait_for_timeout(300)
            only_distance = page.evaluate(READ_STATE)

            # P1: the map must agree with the panel, not just the count.
            assert only_distance["visible"] == ["distance"]
            assert _count(only_distance) == 1
            assert "25%" in only_distance["result"]
            assert 0 < only_distance["paths"] < baseline["paths"]
            assert 0 < only_distance["labels"] < baseline["labels"]

            picked = page.evaluate(PICK, ["polygon"])
            assert picked["ok"], picked
            page.wait_for_timeout(300)
            two_types = page.evaluate(READ_STATE)
            assert sorted(two_types["visible"]) == ["distance", "polygon"]
            assert _count(two_types) == 2
            assert "50%" in two_types["result"]
            assert only_distance["paths"] < two_types["paths"] < baseline["paths"]
            assert only_distance["labels"] < two_types["labels"] < baseline["labels"]

            assert page.evaluate(CLEAR)
            page.wait_for_timeout(300)
            cleared = page.evaluate(READ_STATE)
            assert cleared["filter"] is None
            assert _count(cleared) == 4
            assert "100%" in cleared["result"]
            assert cleared["paths"] == baseline["paths"]
            assert cleared["labels"] == baseline["labels"]

            assert not errors, f"JS errors: {errors}"

    def test_filter_persists_across_reload(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            assert page.evaluate(PICK, ["distance"])["ok"]
            page.wait_for_timeout(300)
            assert sorted(page.evaluate(READ_STATE)["visible"]) == ["distance"]

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
            }
            assert sorted(restored["visible"]) == ["distance"]
            assert _count(restored) == 1
            assert "25%" in restored["result"]
            # Reloaded leaves are hidden until the persisted filter is re-applied.
            assert restored["paths"] < baseline["paths"]
            assert not errors, f"JS errors: {errors}"

    def test_stale_persisted_filter_is_dropped_on_load(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            baseline = _draw_all(page)
            assert _count(baseline) == 4

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
            restored = page.evaluate(READ_STATE)

            # P2: an expired condition must read as "no filter", never keep=0.
            assert restored["filter"] is None
            assert _count(restored) == 4
            assert "100%" in restored["result"]
            assert restored["paths"] == baseline["paths"]
            assert not errors, f"JS errors: {errors}"

    def test_export_geojson_contains_only_kept_measurements(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _draw_all(page)
            assert page.evaluate(PICK, ["distance"])["ok"]
            page.wait_for_timeout(300)
            assert page.evaluate(READ_STATE)["visible"] == ["distance"]

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
            assert page.evaluate(PICK, ["distance"])["ok"]
            page.wait_for_timeout(300)
            assert page.evaluate(READ_STATE)["visible"] == ["distance"]

            assert page.evaluate(EXPAND_MEASURE)
            with page.expect_download() as download:
                assert page.evaluate(CLICK_EXPORT)
            text = download.value.path().read_text(encoding="utf-8-sig")
            rows = [line for line in text.splitlines() if line.strip()]

            # Header + one kept row: hidden measurements are not exported.
            assert len(rows) == 2
            assert "distance" in rows[1]
            assert not errors, f"JS errors: {errors}"
