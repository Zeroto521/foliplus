"""Shared helpers for ExportControl browser tests."""

from __future__ import annotations

import base64
import io
import re

import folium
from conftest import _js, make_browser_page

from foliplus import ExportControl, MeasureControl


def _stub_html(html: str) -> str:
    """Remove blocking CDN <script> tags and inject stubs for GeoTIFF/pako."""
    from foliplus._cdn_loader import load_cdn

    for _name, url in load_cdn("ExportControl"):
        html = html.replace(f'<script src="{url}"></script>', "")
    marker = 'CONFIG = {"name": "ExportControl"'
    idx = html.find(marker)
    if idx > 0:
        semi = html.find(";", idx)
        if semi > 0:
            stub = (
                "window.GeoTIFF={writeArrayBuffer:function(){return new ArrayBuffer(0)}};"
                "window.pako={deflateRaw:function(a){return a}};"
            )
            html = html[: semi + 1] + stub + html[semi + 1 :]
    return html


def _make_page(browser, tmp_path, *layers, slug="export", locale=None):
    from foliplus import LayerControl

    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    # A non-None locale pins the rendered language for gates that read a
    # translated string; leaving it unset keeps the ambient-locale render that
    # the other gate pages rely on.
    LayerControl(locale=locale).add_to(m)
    ExportControl().add_to(m)
    for layer in layers:
        layer.add_to(m)
    html = _stub_html(m.get_root().render())
    # Inject test hooks at the control-entry line: a synchronous rafLoop
    # scheduler (read by the lazily-created manager), then the control and
    # its manager read back via `mgr` (dev build keeps these names). The
    # LayerControl instance is exposed too, so export tests can drive
    # annotation labels.
    html, n = re.subn(
        r"(new ExportControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__foliplusExportScheduler = function(fn){return 0;}; window.__exportCtrl = \1 window.__exportManager = window.__exportCtrl.mgr; window.__map = map;",
        html,
        count=1,
    )
    assert n == 1, "ExportControl instantiation not found in rendered HTML"
    html, n = re.subn(
        r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__layerCtrl = \1",
        html,
        count=1,
    )
    assert n == 1, "LayerControl instantiation not found in rendered HTML"
    # Inject MeasureControl hooks if present.
    html, n = re.subn(
        r"(new MeasureControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
        r"window.__measureCtrl = \1 window.__measureManager = window.__measureCtrl.mgr;",
        html,
        count=1,
    )
    if n == 0:
        html, n = re.subn(
            r"(new MeasureControl\([^)]*\)\.addTo\(map\);)",
            r"window.__measureCtrl = \1 window.__measureManager = window.__measureCtrl.mgr;",
            html,
            count=1,
        )
    if n == 0 and any(isinstance(l, MeasureControl) for l in layers):
        raise AssertionError("MeasureControl instantiation not found in rendered HTML")
    page, errors = make_browser_page(browser, tmp_path, html, slug)
    page.wait_for_selector(".foliplus-export-ctrl", state="attached", timeout=10000)
    return page, errors


def _solid_tile_url(rgb: tuple[int, int, int]) -> str:
    """A 256x256 solid-color tile as a data URI.

    A ``TileLayer`` built from it is a genuine basemap that paints real
    pixels with no network at all — browser tests block every tile host —
    so a test can assert on what two basemaps composite to in an export.
    """
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (256, 256), rgb).save(buf, "PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def _solid_tile_layer(
    rgb: tuple[int, int, int], name: str, opacity: float = 1.0
) -> folium.TileLayer:
    """A ``folium.TileLayer`` backed by a solid-color data URI.

    ``TileLayer`` takes the URL as its first positional argument
    (``tiles``); passing ``url_template=`` as a keyword swallows the
    value into ``**kwargs`` and falls back to OSM, whose requests the
    CDN proxy 404s. Positional is the only form that survives.
    """
    return folium.TileLayer(
        _solid_tile_url(rgb),
        name=name,
        attr="Test tile",
        overlay=False,
        show=True,
        opacity=opacity,
    )


def _run_export(page) -> None:
    """Drive the full export flow: open the control, lock the box, export.

    Install :meth:`_install_canvas_hook` first so the renderer's own output
    canvas is captured for pixel assertions.
    """
    page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
    page.wait_for_selector(".foliplus-export-box", state="attached", timeout=5000)
    page.locator(".foliplus-tool-bar .foliplus-confirm").click()
    page.wait_for_selector(
        ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
    )
    page.locator(".foliplus-tool-bar .foliplus-confirm").click()
    page.wait_for_function(_js("ExportControl/wait_export_collapsed"), timeout=30000)
    page.wait_for_timeout(2000)


def _wait_export_canvas_ready(page, timeout: int = 15000) -> None:
    # Wait until the renderer's output canvas has been captured and painted.
    # The export renderer creates its output canvas via document.createElement
    # (never attached to the DOM), and _install_canvas_hook intercepts that
    # factory to keep a window._capturedCanvases list. The collapsed-control
    # wait only proves the flow finished; the canvas must also be non-empty and
    # have real painted pixels before a pixel assertion reads it. A fixed
    # wait_for_timeout is raster/network timing, which is exactly the flake
    # class these waits exist to remove.
    page.wait_for_function(
        _js("ExportControl/wait_export_canvas_captured"), timeout=timeout
    )


def _install_canvas_hook(page) -> None:
    """Hook ``document.createElement`` to capture canvases the renderer
    makes internally (never attached to the DOM). Same trick
    ``test_export_marker_opacity_blend`` uses; fresh-page-per-test means
    the patch can't leak.
    """
    page.evaluate(_js("ExportControl/install_canvas_hook"))


def _sample_pixels_in_export(
    page, match: tuple[int, ...], tol: int, alpha_min: int
) -> dict:
    """Count pixels matching ``match`` in the renderer's output canvas."""
    page.evaluate(
        _js("ExportControl/set_sample_params"),
        {"color": list(match), "tol": tol, "alphaMin": alpha_min},
    )
    return page.evaluate(_js("ExportControl/sample_export_canvas"))


def _red_pixels_in_export(page) -> dict:
    """Count red pixels in the renderer's output canvas (default match/tol)."""
    return _sample_pixels_in_export(page, (230, 30, 30), 30, 200)


def _sample_bg_pixels_in_export(page, match: list[int]) -> dict:
    """Count pixels matching ``match`` with a tighter tolerance for bg fills."""
    return _sample_pixels_in_export(page, tuple(match), 20, 200)
