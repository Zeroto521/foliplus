"""The scheme strips line up with the trigger in both list states.

A layout scrollbar reserves real width inside the open list, so the item strip
used to end short of the trigger strip whenever the list scrolled (the reported
bug). Playwright's default `--hide-scrollbars` makes the lane disappear, which
is why earlier headless runs measured a fake 0; this module launches its own
Chromium without that argument so the real lane is measured, at DPR1 and DPR2.
"""

from __future__ import annotations

import json
import re

import folium
import pytest
from conftest import (
    _CdnBrowserProxy,
    _js,
    _prefetch_cdn_cache,
    heatmap_ready,
    panel_ready,
)

from foliplus import HeatmapControl, LayerControl

HEATMAP_TRIGGER = ".foliplus-heatmap-scheme-bar"
LAYER_TRIGGER = ".foliplus-layer-style-panel .foliplus-scheme-picker-trigger"
# Seven defaults fill the 200px list; four fit inside it.
FITTING_SCHEMES = ["Reds", "Blues", "Greens", "Purples"]


@pytest.fixture(scope="module")
def scrollbar_browser(browser):
    """Chromium with real scrollbars: Playwright hides them by default.

    Launches a second Browser from the session fixture's own Playwright
    connection: one process owns one Playwright context, so a nested
    sync_playwright() would trip "Sync API inside the asyncio loop".
    """
    _prefetch_cdn_cache()
    real = browser.browser_type.launch(
        headless=True, ignore_default_args=["--hide-scrollbars"]
    )
    try:
        yield _CdnBrowserProxy(real)
    finally:
        real.close()


def _polygon_layer() -> folium.GeoJson:
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"value": 10 + i},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [119.28 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.06],
                        ]
                    ],
                },
            }
            for i in range(3)
        ],
    }
    return folium.GeoJson(json.dumps(data), name="Polygon data")


def _points_group() -> folium.FeatureGroup:
    fg = folium.FeatureGroup(name="Points", show=True)
    gj = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"val": 1.0 + i},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [119.30 + i * 0.01, 26.08],
                    },
                }
                for i in range(3)
            ],
        }
    )
    folium.GeoJson(gj).add_to(fg)
    return fg


def _expose_heatmap(html: str) -> str:
    matches = list(re.finditer(r"([a-zA-Z0-9_$]+)\.addTo\(map\);", html))
    if matches:
        m = matches[-1]
        html = (
            html[: m.start()]
            + f"window.__heatmapCtrl = {m.group(1)};"
            + html[m.start() :]
        )
    return html


def _make_page(browser, tmp_path, dpr: int, schemes: list[str] | None = None):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    heatmap = HeatmapControl(position="bottomleft")
    if schemes is not None:
        heatmap = HeatmapControl(position="bottomleft", schemes=schemes)
    heatmap.add_to(m)
    html = _expose_heatmap(m.get_root().render())
    html_path = tmp_path / f"scheme_strip_dpr{dpr}.html"
    html_path.write_text(html, encoding="utf-8")
    page = browser.new_page(
        viewport={"width": 1440, "height": 900}, device_scale_factor=dpr
    )
    errors: list[str] = []
    page.on(
        "console",
        lambda msg: (
            errors.append(msg.text)
            if msg.type == "error"
            and not msg.text.startswith("Failed to load resource")
            else None
        ),
    )
    page.goto(html_path.as_uri(), wait_until="domcontentloaded")
    return page, errors


def _open_heatmap_list(page) -> None:
    if not page.evaluate(_js("HeatmapControl/panel_is_open")):
        page.evaluate(_js("HeatmapControl/click_toggle_button"))
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        heatmap_ready(page)
    options = page.evaluate(_js("HeatmapControl/read_layer_options"))
    assert options, "the heatmap offers no layer to select"
    page.evaluate(_js("HeatmapControl/select_layer"), options[0])
    page.wait_for_timeout(150)
    assert page.evaluate(_js("HeatmapControl/click_scheme_bar"))
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _open_layer_list(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel_polygon"))
    assert opened["ok"], opened
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], ready
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _measure(page, trigger: str) -> dict:
    return page.evaluate(_js("common/measure_scheme_strip"), trigger)


def _assert_aligned(sample: dict) -> None:
    assert sample["ok"], sample
    trigger = sample["triggerBar"]
    assert sample["itemBars"], sample
    for bar in sample["itemBars"]:
        assert abs(bar["left"] - trigger["left"]) <= 1, (bar, trigger)
        assert abs(bar["right"] - trigger["right"]) <= 1, (bar, trigger)
        assert abs(bar["width"] - trigger["width"]) <= 1, (bar, trigger)


class TestSchemeStripAlignmentBrowser:
    """One strip geometry for the trigger and every list row, both states."""

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_heatmap_strips_match_with_a_layout_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        page, errors = _make_page(scrollbar_browser, tmp_path, dpr)
        try:
            _open_heatmap_list(page)
            sample = _measure(page, HEATMAP_TRIGGER)
            assert sample["lane"] >= 1, f"real scrollbar lane missing: {sample}"
            assert sample["scrollable"], sample
            _assert_aligned(sample)
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_heatmap_strips_match_without_a_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        page, errors = _make_page(scrollbar_browser, tmp_path, dpr, FITTING_SCHEMES)
        try:
            _open_heatmap_list(page)
            sample = _measure(page, HEATMAP_TRIGGER)
            assert not sample["scrollable"], sample
            _assert_aligned(sample)
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_style_drawer_strips_match_with_a_layout_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        page, errors = _make_page(scrollbar_browser, tmp_path, dpr)
        try:
            _open_layer_list(page)
            sample = _measure(page, LAYER_TRIGGER)
            assert sample["lane"] >= 1, f"real scrollbar lane missing: {sample}"
            _assert_aligned(sample)
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
