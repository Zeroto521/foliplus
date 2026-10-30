"""Shared helpers for HeatmapControl browser tests."""

from __future__ import annotations

import json
import re
from pathlib import Path

import folium
from conftest import _js, heatmap_ready, make_browser_page, snippet

from foliplus import HeatmapControl
from foliplus._cdn_loader import load_cdn

_H3_STUB = snippet("heatmap/h3_stub").strip()


def _stub_html(html: str, *, marker: str = 'CONFIG = {"name": "HeatmapControl"') -> str:
    """Strip blocking CDN <script> tags and inject h3/ss/chroma stubs.

    The default marker anchors the stubs right after the CONFIG assignment, so
    they land before the HeatmapControl IIFE. ``TestHeatmapAutoFieldBrowser``
    needs an alternative anchor because its stubs must land ahead of the SVG
    icons block; callers pass ``marker="// ==================== SVG Icons
    ===================="``.
    """
    for _name, url in load_cdn("HeatmapControl"):
        html = html.replace(f'<script src="{url}"></script>', "")
    idx = html.find(marker)
    if idx > 0:
        semi = html.find(";", idx)
        if semi > 0:
            html = html[: semi + 1] + _H3_STUB + html[semi + 1 :]
        else:
            html = html[:idx] + _H3_STUB + html[idx:]
    return html


def _expose_ctrl(html: str) -> str:
    """Expose the HeatmapControl instance as ``window.__heatmapCtrl``.

    The control variable is minified (e.g. ``de``) in production builds, so
    match the generic ``<expr>.addTo(map);`` call added last (the
    HeatmapControl mounts after LayerControl) instead of a fixed name.
    """
    matches = list(re.finditer(r"([a-zA-Z0-9_$]+)\.addTo\(map\);", html))
    if matches:
        m = matches[-1]  # last addTo = HeatmapControl
        var_name = m.group(1)
        html = (
            html[: m.start()]
            + f"window.__heatmapCtrl = {var_name};"
            + html[m.start() :]
        )
    return html


def _make_page(
    browser,
    tmp_path,
    expose_ctrl=False,
    num_layers=3,
    prelude=None,
    **ctrl_kwargs,
):
    """Build a page with point layers + HeatmapControl and return (page, errors).

    Parameters
    ----------
    browser
        Playwright browser fixture.
    tmp_path
        Pytest tmp_path fixture.
    expose_ctrl
        If True, expose ``window.__heatmapCtrl`` for test assertions.
    num_layers
        Number of independent point FeatureGroups (default 3). Set to 1
        for auto-select tests.
    prelude
        Optional JS source installed before the page's own scripts run —
        a listener-counting probe needs this so its counts are absolute.
    ctrl_kwargs
        Forwarded to ``HeatmapControl()`` so a test can exercise a
        non-default parameter (e.g. ``collapse_on_outside=False``).
    """
    from foliplus import LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    coords = [(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]
    for i, (lat, lng) in enumerate(coords[:num_layers]):
        fg = folium.FeatureGroup(name=f"Points {i}", show=True)
        gj = json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"val": lat},
                        "geometry": {"type": "Point", "coordinates": [lng, lat]},
                    }
                ],
            }
        )
        folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)

    LayerControl().add_to(m)
    HeatmapControl(**ctrl_kwargs).add_to(m)

    html = _stub_html(m.get_root().render())
    if expose_ctrl:
        html = _expose_ctrl(html)
    page, errors = make_browser_page(
        browser, tmp_path, html, "heatmap", prelude=prelude
    )
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    return page, errors


def _panel_open(page):
    """True while the heatmap panel is expanded, not collapsed."""
    return page.evaluate(_js("HeatmapControl/panel_is_open"))


def _make_autofield_page(
    tmp_path: Path,
    browser,
    features: list[dict],
    agg: str = "sum",
):
    """Render a map with one point FeatureGroup plus HeatmapControl.

    The stub anchor differs from :func:`_stub_html`'s default: this path
    needs the stubs to land ahead of the SVG icons block rather than after
    CONFIG. Returns a ``(page, errors)`` tuple; callers use
    ``use_page`` to ensure the page is closed on exit.
    """
    from foliplus import LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    fg = folium.FeatureGroup(name="Points", show=True)
    for feat in features:
        gj = json.dumps({"type": "FeatureCollection", "features": [feat]})
        folium.GeoJson(gj).add_to(fg)
    fg.add_to(m)

    LayerControl().add_to(m)
    HeatmapControl().add_to(m)

    html = m.get_root().render()
    html = _expose_ctrl(html)
    html = _stub_html(
        html, marker="// ==================== SVG Icons ===================="
    )

    html_path = tmp_path / "test_heatmap_autofield.html"
    html_path.write_text(html, encoding="utf-8")

    page = browser.new_page()

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
    page.goto(f"file://{html_path}", wait_until="domcontentloaded")

    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)

    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded",
        state="attached",
        timeout=5000,
    )
    heatmap_ready(page)

    return page, errors
