"""Browser guards for touch-scroll containment on floating surfaces.

Every floating panel / dropdown list mounted under (or portalled onto) the map
container must stop a touch drag from reaching Leaflet's map handlers, which
would pan/zoom the map instead of scrolling the panel. A shared
`bindFloatingTouch` (common/floating.ts) does this for: the Search candidate/
history panel, every listbox/dropdown popup, and the fold/row panel bodies.

Each test drives a real CDP touch drag over the surface and asserts the map
center+zoom are unchanged while the surface itself scrolls (`scrollTop` moves).

Run from the *worktree* with the worktree's own bundle on the import path and
Playwright's temp dir redirected inside it, so the Node driver does not try to
write the system %TEMP% (blocked by the sandbox):

    PYTHONPATH=<worktree-root> TEMP=<worktree>/.tmp TMP=<worktree>/.tmp TMPDIR=<worktree>/.tmp \
        .venv/Scripts/python.exe -m pytest test/python/control/touch_guard
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import folium
import pytest
from conftest import _inject_window_map, _install_cdn_route, snippet

from foliplus import LayerControl, SearchControl


@pytest.fixture(scope="session")
def touch_browser(browser):
    """A touch-enabled BrowserContext backed by the session browser.

    The default `browser` fixture creates contexts without `has_touch`, so a
    touch test cannot drive Leaflet's touch handlers on it. Build one fresh
    context (has_touch=True) from the same headless Chromium and install the
    CDN route so it stays offline.
    """
    ctx = browser._browser.new_context(has_touch=True)
    _install_cdn_route(ctx)
    yield ctx
    ctx.close()


def _page(touch_browser, html: str, name: str = "page"):
    """Write `html` to a temp file and open it on the touch context."""
    import tempfile

    d = Path(tempfile.mkdtemp())
    hp = d / f"{name}.html"
    hp.write_text(_inject_window_map(html), encoding="utf-8")
    page = touch_browser.new_page()
    errors: list[str] = []
    page.on(
        "console",
        lambda m: (
            errors.append(m.text)
            if m.type == "error" and not m.text.startswith("Failed to load resource")
            else None
        ),
    )
    page.goto(f"file://{hp}", wait_until="domcontentloaded")
    return page, errors


def _touch_drag(page, x, y0, y1, steps=10):
    """Drive a CDP touch drag from (x, y0) to (x, y1)."""
    cdp = page.context.new_cdp_session(page)
    cdp.send(
        "Input.dispatchTouchEvent",
        {"type": "touchStart", "touchPoints": [{"x": x, "y": y0}]},
    )
    for i in range(1, steps + 1):
        yy = y0 + (y1 - y0) * i / steps
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [{"x": x, "y": yy}]},
        )
        time.sleep(0.02)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def _map_center_zoom(page):
    return page.evaluate(snippet("common/read_map_center_zoom"))


def _assert_map_unchanged(before, after):
    assert abs(after[0] - before[0]) < 1e-5, (before, after)
    assert abs(after[1] - before[1]) < 1e-5, (before, after)
    assert after[2] == before[2], (before, after)


class TestTouchGuardBrowser:
    """A touch drag over a floating surface must not pan/zoom the map."""

    def test_search_history_panel_touch_drag(self, touch_browser, tmp_path):
        """Search history panel: touch drag scrolls the panel, not the map."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        SearchControl(mode="addr").add_to(m)
        html = m.get_root().render()
        page, errors = _page(touch_browser, html, "search")
        page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
        # Seed 25 addr history entries so the panel overflows and scrolls.
        page.evaluate(snippet("touch_guard/seed_search_history"))
        page.reload(wait_until="domcontentloaded")
        page.wait_for_selector(".foliplus-search", state="attached", timeout=10000)
        page.evaluate(
            "document.querySelector('.foliplus-search .foliplus-toggle-btn')?.click()"
        )
        page.wait_for_selector(
            ".foliplus-search.foliplus-is-expanded", state="attached", timeout=5000
        )
        page.wait_for_timeout(400)
        rect = page.evaluate(
            f"({snippet('common/element_rect')})('.foliplus-search-result-panel')"
        )
        st0 = page.evaluate(
            f"({snippet('common/read_scroll_top')})('.foliplus-search-result-panel')"
        )
        before = _map_center_zoom(page)
        _touch_drag(
            page,
            rect["x"] + rect["w"] / 2,
            rect["y"] + rect["h"] / 2,
            rect["y"] + rect["h"] / 2 - 100,
        )
        page.wait_for_timeout(300)
        after = _map_center_zoom(page)
        _assert_map_unchanged(before, after)
        st1 = page.evaluate(
            f"({snippet('common/read_scroll_top')})('.foliplus-search-result-panel')"
        )
        assert st1 != st0, (st0, st1)
        assert not errors, f"JS errors: {errors}"

    def test_dropdown_list_touch_drag(self, touch_browser, tmp_path):
        """A dropdown list (LayerControl enum filter) must not pan the map."""
        layer = folium.FeatureGroup(name="Touch scroll")
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        layer.add_to(m)
        html = m.get_root().render()
        page, errors = _page(touch_browser, html, "dropdown")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        page.evaluate(
            "document.querySelector('.foliplus-layer-ctrl .foliplus-toggle-btn')?.click()"
        )
        page.wait_for_selector(
            ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
        )
        page.wait_for_timeout(200)
        ok = page.evaluate(snippet("touch_guard/open_enum_dropdown"))
        assert ok is True, "could not open filter dropdown"
        page.wait_for_selector(".foliplus-dropdown-list", state="visible", timeout=5000)
        rect = page.evaluate(
            f"({snippet('common/element_rect')})('.foliplus-dropdown-list')"
        )
        st0 = page.evaluate(
            f"({snippet('common/read_scroll_top')})('.foliplus-dropdown-list')"
        )
        before = _map_center_zoom(page)
        _touch_drag(
            page,
            rect["x"] + rect["w"] / 2,
            rect["y"] + rect["h"] / 2,
            rect["y"] + rect["h"] / 2 - 80,
        )
        page.wait_for_timeout(300)
        after = _map_center_zoom(page)
        _assert_map_unchanged(before, after)
        # The list itself scrolls (12 options overflow the capped height).
        st1 = page.evaluate(
            f"({snippet('common/read_scroll_top')})('.foliplus-dropdown-list')"
        )
        assert st1 != st0, (st0, st1)
        assert not errors, f"JS errors: {errors}"

    def test_layer_style_panel_touch_drag(self, touch_browser, tmp_path):
        """The LayerControl style panel body must not pan the map on touch."""
        layer = folium.GeoJson(
            json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"value": 1},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [119.30, 26.08],
                                        [119.31, 26.08],
                                        [119.31, 26.09],
                                        [119.30, 26.09],
                                        [119.30, 26.08],
                                    ]
                                ],
                            },
                        }
                    ],
                }
            ),
            name="Polygon data",
        )
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        layer.add_to(m)
        html = m.get_root().render()
        page, errors = _page(touch_browser, html, "style")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        page.evaluate(
            "document.querySelector('.foliplus-layer-ctrl .foliplus-toggle-btn')?.click()"
        )
        page.wait_for_selector(
            ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
        )
        page.wait_for_timeout(200)
        # Open the ⋮ → Style panel on the first overlay row (shared snippet).
        page.evaluate(snippet("touch_guard/open_layer_style_panel"))
        page.wait_for_selector(
            ".foliplus-layer-style-panel", state="visible", timeout=5000
        )
        rect = page.evaluate(
            f"({snippet('common/element_rect')})('.foliplus-layer-style-panel .foliplus-panel-content')"
        )
        before = _map_center_zoom(page)
        _touch_drag(
            page,
            rect["x"] + rect["w"] / 2,
            rect["y"] + rect["h"] / 2,
            rect["y"] + rect["h"] / 2 - 80,
        )
        page.wait_for_timeout(300)
        after = _map_center_zoom(page)
        _assert_map_unchanged(before, after)
        assert not errors, f"JS errors: {errors}"

    def test_heatmap_panel_touch_drag(self, touch_browser, tmp_path):
        """The HeatmapControl fold-panel body must not pan the map on touch.

        HeatmapControl's fold panel is built by the shared ``createPanelControl``
        factory (core/leaflet/panel.ts), which binds ``bindFloatingTouch`` on the
        scrollable ``.foliplus-panel-content`` — so this surface is guarded by
        construction, and this test pins that behaviour for the heatmap control.
        """
        import json

        from foliplus import HeatmapControl
        from foliplus._cdn_loader import load_cdn

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points 0", show=True)
        gj = json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"val": 26.08},
                        "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
                    }
                ],
            }
        )
        folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)
        HeatmapControl().add_to(m)
        html = m.get_root().render()
        stub = snippet("HeatmapControl/h3_stub").strip()
        for _name, url in load_cdn("HeatmapControl"):
            html = html.replace(f'<script src="{url}"></script>', "")
        idx = html.find('CONFIG = {"name": "HeatmapControl"')
        if idx > 0:
            semi = html.find(";", idx)
            html = html[: semi + 1] + stub + html[semi + 1 :]
        page, errors = _page(touch_browser, html, "heatmap")
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl", state="attached", timeout=10000
        )
        page.evaluate(
            "document.querySelector('.foliplus-heatmap-ctrl .foliplus-toggle-btn')?.click()"
        )
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        page.wait_for_timeout(300)
        rect = page.evaluate(
            f"({snippet('common/element_rect')})('.foliplus-heatmap-ctrl .foliplus-panel-content')"
        )
        before = _map_center_zoom(page)
        _touch_drag(
            page,
            rect["x"] + rect["w"] / 2,
            rect["y"] + rect["h"] / 2,
            rect["y"] + rect["h"] / 2 - 80,
        )
        page.wait_for_timeout(300)
        after = _map_center_zoom(page)
        _assert_map_unchanged(before, after)
        assert not errors, f"JS errors: {errors}"
