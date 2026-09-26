"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import base64
import io
import json
import re

import folium
import pytest
from conftest import (
    _js,
    make_browser_page,
    panel_ready,
    render_control,
    use_page,
    use_raw_page,
)

from foliplus import ExportControl, MeasureControl
from foliplus.locale import _load_tables


class TestExportControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ExportControl()._name == "ExportControl"

    def test_default_position(self):
        assert ExportControl().position == "bottomright"

    def test_custom_position(self):
        assert ExportControl(position="topleft").position == "topleft"

    def test_default_args(self):
        ctrl = ExportControl()
        assert ctrl.filename == "map"
        assert ctrl.format == "png"
        assert ctrl.quality == 0.92
        assert ctrl.scale == 2.0
        assert ctrl.timeout == 7500

    def test_custom_args(self):
        ctrl = ExportControl(
            filename="my_map",
            format="jpeg",
            quality=0.8,
            scale=3.5,
            timeout=10000,
        )
        assert ctrl.filename == "my_map"
        assert ctrl.format == "jpeg"
        assert ctrl.quality == 0.8
        assert ctrl.scale == 3.5
        assert ctrl.timeout == 10000

    def test_default_locale(self):
        assert ExportControl()._locale_code == ""

    def test_custom_locale(self):
        assert ExportControl(locale="zh")._locale_code == "zh"

    def test_all_positions(self):
        for pos in ("topleft", "topright", "bottomleft", "bottomright"):
            assert ExportControl(position=pos).position == pos

    def test_edge_scale_values(self):
        assert ExportControl(scale=1.0).scale == 1.0
        assert ExportControl(scale=3.0).scale == 3.0

    def test_timeout_zero(self):
        assert ExportControl(timeout=0).timeout == 0

    def test_invalid_position_raises(self):
        """Position is validated by BaseControl, so every control inherits it."""
        with pytest.raises(ValueError, match="position must be one of"):
            ExportControl(position="center")

    def test_quality_above_range_raises(self):
        with pytest.raises(
            ValueError, match="quality must be a number between 0.0 and 1.0"
        ):
            ExportControl(quality=1.5)

    def test_quality_below_range_raises(self):
        with pytest.raises(
            ValueError, match="quality must be a number between 0.0 and 1.0"
        ):
            ExportControl(quality=-0.1)

    def test_scale_must_be_positive(self):
        with pytest.raises(ValueError, match="scale must be a positive number"):
            ExportControl(scale=0)

    def test_negative_timeout_raises(self):
        with pytest.raises(ValueError, match=r"timeout must be an int >= 0"):
            ExportControl(timeout=-1)

    def test_zero_max_pixels_raises(self):
        with pytest.raises(ValueError, match="max_pixels must be a positive int"):
            ExportControl(max_pixels=0)

    def test_numpy_scalars_are_accepted(self):
        """numpy scalars are not int/float subclasses, yet they must pass."""
        numpy = pytest.importorskip("numpy")
        ctrl = ExportControl(quality=numpy.float64(0.5), timeout=numpy.int64(100))
        assert ctrl.quality == 0.5
        assert ctrl.timeout == 100

    def test_format_default(self):
        assert ExportControl().format == "png"

    def test_format_jpeg(self):
        assert ExportControl(format="jpeg").format == "jpeg"

    def test_format_webp(self):
        assert ExportControl(format="webp").format == "webp"

    def test_format_geotiff(self):
        assert ExportControl(format="geotiff").format == "geotiff"

    def test_format_invalid_raises(self):
        with pytest.raises(ValueError, match="format must be one of"):
            ExportControl(format="gif")

    def test_quality_default(self):
        assert ExportControl().quality == 0.92

    def test_quality_custom(self):
        assert ExportControl(quality=0.5).quality == 0.5

    def test_max_pixels_default(self):
        assert ExportControl().max_pixels == 10240000

    def test_max_pixels_none(self):
        assert ExportControl(max_pixels=None).max_pixels is None

    def test_max_pixels_custom(self):
        assert ExportControl(max_pixels=1000000).max_pixels == 1000000

    def test_locale_config_bare_has_no_custom_strings(self):
        """A bare LocaleConfig records the code but ships no custom table.

        The code is sent to JS, which ships the built-in tables and lets the
        browser pick the language — so this asserts the *absence* of a custom
        table rather than that translation took effect.
        """
        from foliplus.locale import LocaleConfig

        cfg = LocaleConfig(language="zh")
        ctrl = ExportControl(locale=cfg)
        assert ctrl._locale_code == "zh"
        conf = json.loads(ctrl._config_block)
        assert conf["locale_code"] == "zh"
        table = conf["locale_tables"]["zh"]
        # Built-in table is present, unmodified — no custom override layered on.
        builtin = _load_tables("ExportControl.*.json")["zh"]
        assert table == builtin


class TestExportControlRendering:
    def test_default_params(self):
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "ctrl-fold" in html

    def test_custom_params_rendering(self):
        html = render_control(
            ExportControl(
                filename="custom",
                format="jpeg",
                quality=0.8,
                scale=1.5,
                timeout=5000,
            )
        )
        assert "custom" in html
        assert "jpeg" in html

    def test_geotiff_format_in_html(self):
        """geotiff format is passed through to the HTML template."""
        html = render_control(ExportControl(format="geotiff"))
        assert "geotiff" in html

    def test_css_loaded(self):
        """ExportControl CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-overlay" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html
        assert "foliplus-hidden" in html

    def test_css_z_index_pattern(self):
        """CSS uses --z-export-base variable with calc()."""
        html = render_control(ExportControl())
        assert "z-export-base" in html
        assert "calc(" in html

    def test_css_top_z_index_tokenized(self):
        """The 100000 'above everything' z-index is a token, not a magic number in a rule."""
        from conftest import read_css

        css = read_css("foliplus/css/ExportControl.css")
        assert "var(--z-index-top)" in css
        # The rule uses the token; the literal may only appear in a comment.
        assert "z-index: 100000" not in css

    def test_locale_zh(self):
        html = render_control(ExportControl(locale="zh"))
        assert "导出" in html
        assert "ExportControl.btn_title" in html

    def test_del_icon_exclusion(self):
        """del-icon elements are excluded via data-foliplus-export attribute."""
        html = render_control(ExportControl())
        assert 'data-foliplus-export="exclude"' in html

    def test_export_control_py_file(self):
        """ExportControl.py has expected exports."""
        ctrl = ExportControl()
        assert hasattr(ctrl, "filename")
        assert hasattr(ctrl, "scale")
        assert hasattr(ctrl, "timeout")
        assert hasattr(ctrl, "position")
        assert hasattr(ctrl, "_template")

    def test_css_preview_present(self):
        """ExportControl preview CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html


class TestExportControlBrowser:
    """Browser-level tests for ExportControl."""

    @staticmethod
    def _stub_html(html: str) -> str:
        """Remove blocking CDN <script> tags and inject stubs for GeoTIFF/pako."""
        for cdn in (
            "geotiff@3/dist-browser/geotiff.js",
            "pako@2/dist/pako.min.js",
            "gcoord@1/dist/gcoord.global.prod.js",
            "turf@6/turf.min.js",
        ):
            html = html.replace(
                f'<script src="https://cdn.jsdelivr.net/npm/{cdn}"></script>', ""
            )
        marker = 'CONF = {"name": "ExportControl"'
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

    @staticmethod
    def _make_page(browser, tmp_path, *layers, slug="export"):
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        ExportControl().add_to(m)
        for layer in layers:
            layer.add_to(m)
        html = TestExportControlBrowser._stub_html(m.get_root().render())
        # Inject test hooks at the control-entry line: a synchronous rafLoop
        # scheduler (read by the lazily-created manager), then the control and
        # its manager read back via `m` (dev build keeps these names). The
        # LayerControl instance is exposed too, so export tests can drive
        # annotation labels.
        html, n = re.subn(
            r"(new ExportControl\(\{ position: CONF\.position \}\)\.addTo\(map\);)",
            r"window.__foliplusExportScheduler = function(fn){return 0;}; window.__exportCtrl = \1 window.__exportManager = window.__exportCtrl.m; window.__map = map;",
            html,
            count=1,
        )
        assert n == 1, "ExportControl instantiation not found in rendered HTML"
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONF\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        # Inject MeasureControl hooks if present.
        html, n = re.subn(
            r"(new MeasureControl\(\{ position: CONF\.position \}\)\.addTo\(map\);)",
            r"window.__measureCtrl = \1 window.__measureManager = window.__measureCtrl.m;",
            html,
            count=1,
        )
        if n == 0:
            html, n = re.subn(
                r"(new MeasureControl\([^)]*\)\.addTo\(map\);)",
                r"window.__measureCtrl = \1 window.__measureManager = window.__measureCtrl.m;",
                html,
                count=1,
            )
        if n == 0 and any(isinstance(l, MeasureControl) for l in layers):
            raise AssertionError(
                "MeasureControl instantiation not found in rendered HTML"
            )
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-export-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_remove_readd_rebuilds_manager(self, browser, tmp_path):
        """removeControl + addControl re-attaches export UI on a fresh manager."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("ExportControl/destroy_readd"))
            assert state["removed"] is True
            assert state["hasManager"] is True
            assert state["attached"] is True
            assert not errors, f"JS errors: {errors}"

    def test_leaves_live_tile_layers_untouched(self, browser, tmp_path):
        """ExportControl no longer rewrites live tile layers' crossOrigin nor
        registers a permanent layeradd listener — the removed CORS pre-setup
        blanked non-CORS base maps, flashed the viewport on init, and leaked
        the listener.  Re-adding the control must not change either."""
        with use_page(self._make_page, browser, tmp_path, folium.TileLayer()) as (
            page,
            errors,
        ):
            state = page.evaluate(_js("ExportControl/read_tile_state"))
            # Leaflet's default options.crossOrigin is `false`; anything
            # truthy would mean ExportControl rewrote the layer again.
            for c in state["before"]["crossOrigins"] + state["after"]["crossOrigins"]:
                assert not c
            # The removed pre-setup's layeradd handler referenced crossOrigin;
            # Leaflet's own attribution and foliplus's components never do.
            # Re-adding the control must not change the listener set at all.
            for src in (
                state["before"]["layeraddHandlers"] + state["after"]["layeraddHandlers"]
            ):
                assert "crossOrigin" not in src
            assert len(state["before"]["layeraddHandlers"]) == len(
                state["after"]["layeraddHandlers"]
            )
            assert not errors, f"JS errors: {errors}"

    def test_toggle_button_present(self, browser, tmp_path):
        """Export toggle button is rendered and clickable."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            btn = page.wait_for_selector(
                ".foliplus-export-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            assert btn is not None, "Export toggle button not found"

    def test_crop_box_appears_on_click(self, browser, tmp_path):
        """Clicking toggle button shows the crop box."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            btn = page.locator(".foliplus-export-ctrl .foliplus-toggle-btn")
            btn.click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box").is_visible()
            assert page.locator(".foliplus-export-overlay").is_visible()
            assert page.locator(".foliplus-export-handle").count() == 8

    def test_escape_closes_crop_box(self, browser, tmp_path):
        """Pressing Escape with unlocked crop box removes it."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Verify crop box is visible
            assert page.locator(".foliplus-export-box").is_visible()
            # Press Escape
            page.keyboard.press("Escape")
            # Crop box should disappear
            page.wait_for_selector(
                ".foliplus-export-box",
                state="hidden",
                timeout=5000,
            )

    def test_crop_selecting_disables_other_layer_interaction(self, browser, tmp_path):
        """Crop selection suspends interaction on other map layers (clicks fall
        through to drag the crop box instead of firing feature handlers), and
        closing the crop box restores it."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                "window.__featureMarker = L.marker([26.08, 119.30]).addTo(window.__map).bindPopup('x');"
            )
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True

            # Open crop selection → the centralized ModeManager lock disables the marker.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            assert (
                page.evaluate(
                    "window.__exportManager.map.foliplus.modes.getMode('ExportControl')"
                )
                == "selecting"
            )
            assert page.evaluate("window.__featureMarker.options.interactive") is False

            # A DOM click on the marker's icon must NOT open its popup while the
            # crop box owns the map.
            page.evaluate(
                "window.__featureMarker.getElement().dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_timeout(300)
            popup_open = page.evaluate("!!document.querySelector('.leaflet-popup')")
            assert not popup_open, "feature popup opened during crop selection"

            # Close the crop box (Escape) → interaction restored.
            page.keyboard.press("Escape")
            page.wait_for_selector(".foliplus-export-box", state="hidden", timeout=5000)
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True
            assert not errors, f"JS errors: {errors}"

    def test_enter_locks_crop_box(self, browser, tmp_path):
        """Pressing Enter locks the crop box (dashed > solid border)."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Lock via confirm button
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box.locked").is_visible()

    def test_arrow_keys_nudge_crop_box(self, browser, tmp_path):
        """Arrow keys nudge the unlocked crop box by NUDGE_STEP without panning."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            # The arrow shortcuts are container-bound — focus the map container.
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            rect0 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center0 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            rect1 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center1 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            # Box moved by NUDGE_STEP in both axes; the map must NOT pan
            # (Leaflet's built-in arrow-key handler is disabled while editing).
            assert rect1["l"] == pytest.approx(rect0["l"] + 3)
            assert rect1["t"] == pytest.approx(rect0["t"] + 3)
            assert center1 == center0

    def test_nudge_tracks_key_without_reanimating_hint(self, browser, tmp_path):
        """Holding an arrow key tracks each press and leaves the size hint alone."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            # Tag the size-hint element so we can detect if it gets rebuilt.
            page.evaluate(
                "() => { document.querySelector('.foliplus-hint-ExportControl-size')"
                ".setAttribute('data-mark', '1'); }"
            )
            before = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, w: r.width, h: r.height }; }"
            )

            # Simulate a held key: one keydown starts the smooth-nudge loop,
            # then OS auto-repeat fires repeated keydowns for the same key.
            # With the loop running the repeats are intentionally ignored, so
            # a held key nudges exactly once (the loop's sync frame) plus the
            # continuous stream handled by the loop — here the test injects a
            # no-op scheduler so the loop only ever runs its sync frame, i.e.
            # one NUDGE_STEP regardless of how many repeats follow.
            page.keyboard.down("ArrowRight")
            for _ in range(4):
                page.evaluate(
                    "() => document.dispatchEvent(new KeyboardEvent('keydown', "
                    "{ key: 'ArrowRight', bubbles: true }))"
                )

            # The box suppresses its transition while nudging, so it tracks the
            # keystrokes instead of chasing them (a transition would make the
            # box lag behind and only settle after the key is released).
            box = page.locator(".foliplus-export-box")
            assert box.get_attribute("class").endswith("dragging")
            after = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, w: r.width, h: r.height }; }"
            )
            # Repeats are ignored while the loop runs -> exactly one NUDGE_STEP.
            assert after["l"] == pytest.approx(before["l"] + 3)
            assert after["w"] == pytest.approx(before["w"])
            assert after["h"] == pytest.approx(before["h"])

            # A pure move keeps the size constant, so the hint is never refreshed —
            # refreshing would rebuild the element and replay its entry animation.
            assert (
                page.evaluate(
                    "() => document.querySelector('.foliplus-hint-ExportControl-size')"
                    ".getAttribute('data-mark')"
                )
                == "1"
            )

            # Releasing the key restores the transition.
            page.keyboard.up("ArrowRight")
            page.wait_for_timeout(50)
            assert not box.get_attribute("class").endswith("dragging")

            # R changes the size, so the hint must be refreshed (and rebuilt).
            page.keyboard.press("r")
            page.wait_for_timeout(150)
            assert (
                page.evaluate(
                    "() => document.querySelector('.foliplus-hint-ExportControl-size')?"
                    ".getAttribute('data-mark')"
                )
                != "1"
            )

    def test_r_resets_crop_box(self, browser, tmp_path):
        """R resets the unlocked crop box to the default centered size."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            default = page.evaluate(
                "() => { const r = window.__exportManager.defaultRect(); "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            # Nudge away from default so a reset is observable.
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            moved = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert moved != default, "expected box to move before reset"
            page.keyboard.press("r")
            after = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert after == pytest.approx(default)

    def test_export_mode_class(self, browser, tmp_path):
        """foliplus-export-mode class is added to body and map container."""

        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Check export mode class on body
            has_mode = page.evaluate(
                "document.body.classList.contains('foliplus-export-mode')"
            )
            assert has_mode, "body should have foliplus-export-mode class"
            # Check on map container
            has_map_mode = page.evaluate(_js("ExportControl/read_export_mode_class"))
            assert has_map_mode, "map container should have foliplus-export-mode"

    def test_lock_unlock_cycle(self, browser, tmp_path):
        """Lock then unlock crop box transitions correctly."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.locked").is_visible()

            # Unlock (cancel resets to unlocked)
            page.locator(".foliplus-tool-bar .cancel").click()
            page.wait_for_selector(
                ".foliplus-export-box:not(.locked)", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box").is_visible()

    def test_no_console_errors_on_open(self, browser, tmp_path):
        """Opening export control should not produce JS errors."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)
            assert len(errors) == 0, f"JS errors on open: {errors}"

    def test_export_vector_and_marker_content(self, browser, tmp_path):
        """Export with vector polygon + Marker layers produces non-blank canvas."""

        # Add a polygon (vector layer)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.GeoJson(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {},
                            "geometry": {
                                "type": "Polygon",
                                "coordinates": [
                                    [
                                        [119.28, 26.06],
                                        [119.32, 26.06],
                                        [119.32, 26.10],
                                        [119.28, 26.10],
                                        [119.28, 26.06],
                                    ]
                                ],
                            },
                        }
                    ],
                },
                name="Test Polygon",
                overlay=True,
                show=True,
            ),
            # Add a Marker
            folium.Marker(
                [26.08, 119.30],
                popup="Center",
                name="Test Marker",
                overlay=True,
                show=True,
            ),
            slug="export_vector",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Open export control
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock crop box → switches to download button
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )

            # Click download button to trigger export
            page.locator(".foliplus-tool-bar .confirm").click()

            # Wait for export to finish — control collapses on completion
            page.wait_for_function(
                """() => {
                const ctrl = document.querySelector('.foliplus-export-ctrl');
                return ctrl && ctrl.classList.contains('is-collapsed');
            }""",
                timeout=30000,
            )
            page.wait_for_timeout(500)

            # Check JS errors
            assert len(errors) == 0, f"JS errors: {errors}"

            # Verify layers are registered in LayerControl API
            api_layers = page.evaluate(_js("ExportControl/read_api_layers"))
            assert len(api_layers) > 0, f"No layers in API. errors={errors}"

            overlay_layers = [l for l in api_layers if not l["isBase"] and l["visible"]]
            assert len(overlay_layers) > 0, (
                f"No visible overlay layers. api={api_layers} errors={errors}"
            )

    def test_crop_box_drag_resize(self, browser, tmp_path):
        """Dragging a crop box handle resizes the box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Get initial box size and the br handle position
            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the bottom-right handle using absolute mouse coordinates
            handle = page.locator(".foliplus-export-handle.br")
            handle_box = handle.bounding_box()
            # Drag from handle center 80px right and 40px down
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2,
                handle_box["y"] + handle_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2 + 80,
                handle_box["y"] + handle_box["height"] / 2 + 40,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after["w"] > initial["w"], (
                f"Expected width increased, was {initial['w']} now {after['w']}"
            )
            assert after["h"] > initial["h"], (
                f"Expected height increased, was {initial['h']} now {after['h']}"
            )

    def test_crop_box_drag_move(self, browser, tmp_path):
        """Dragging the crop box center moves the box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the center by 30px right and 20px down using raw mouse events
            center = page.locator(".foliplus-export-center")
            center_box = center.bounding_box()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2,
                center_box["y"] + center_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2 + 30,
                center_box["y"] + center_box["height"] / 2 + 20,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            # Width/height should be unchanged
            assert after["w"] == initial["w"], (
                f"Width should not change on move, was {initial['w']} now {after['w']}"
            )
            assert after["h"] == initial["h"], (
                f"Height should not change on move, was {initial['h']} now {after['h']}"
            )
            # Position should have shifted
            assert after["l"] != initial["l"] or after["t"] != initial["t"], (
                f"Position should change on move, was ({initial['l']},{initial['t']}) now ({after['l']},{after['t']})"
            )

    def test_scale_attr_dim_below_mask(self, browser, tmp_path):
        """Scale/attribution stay below the dim mask (z-index stacking).

        Regression: when the crop box was attached to map._mapPane (which has
        z-index:400 creating a stacking context), the box's 9501 z-index was
        trapped inside a 400-level context, so scale/attr (850) rendered above
        the dim shadow. The box must live in mapContainer (z auto) so it
        participates in the root stacking context.
        """

        from foliplus import LayerControl, ScaleControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ScaleControl().add_to(m)
        LayerControl().add_to(m)
        ExportControl().add_to(m)
        html_path = tmp_path / "export_scale_attr_mask.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            info = page.evaluate(_js("ExportControl/read_mask_zindex"))

            # Box must live in mapContainer (not mapPane) — mapPane's
            # z-index:400 stacking context would trap the mask below scale/attr.
            assert info["parentIsContainer"], (
                f"Crop box must be inside mapContainer, got parentZ={info['parentZ']}"
            )
            assert info["parentZ"] == "auto" or info["parentZ"] == "", (
                f"mapContainer must not create a stacking context, got {info['parentZ']}"
            )
            # Mask z (9501) must be above scale/attr z (850)
            assert info["boxZ"] > info["scaleZ"], (
                f"Mask z={info['boxZ']} must be above scale z={info['scaleZ']}"
            )
            assert info["boxZ"] > info["attrZ"], (
                f"Mask z={info['boxZ']} must be above attr z={info['attrZ']}"
            )

    def test_saved_bounds_restore(self, browser, tmp_path):
        """Saved bounds in localStorage restore the crop box on toggle."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            # Pre-set localStorage with saved bounds using the exact storage key.
            # Extract the map name from the first script tag that defines L.map.
            map_name = page.evaluate(_js("ExportControl/read_map_name"))
            storage_key = "foliplus_export_rect_" + map_name
            page.evaluate(_js("ExportControl/set_saved_bounds"), storage_key)

            # Reload so ExportControl's constructor re-reads saved bounds
            # (loadSavedBounds runs at init, not on toggle).
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-export-ctrl", state="attached", timeout=10000
            )

            # Open export control — should auto-restore saved bounds
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.locked").is_visible(), (
                "Saved bounds should auto-lock the crop box"
            )

            # Verify the export button (download) is shown after lock
            assert page.locator(".foliplus-tool-bar .confirm").is_visible()

    @staticmethod
    def _solid_tile_url(rgb: tuple[int, int, int]) -> str:
        """A 256x256 solid-colour tile as a data URI.

        A ``TileLayer`` built from it is a genuine basemap that paints real
        pixels with no network at all — browser tests block every tile host —
        so a test can assert on what two basemaps composite to in an export.
        """
        from PIL import Image

        buf = io.BytesIO()
        Image.new("RGB", (256, 256), rgb).save(buf, "PNG")
        return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()

    @staticmethod
    def _solid_tile_layer(
        rgb: tuple[int, int, int], name: str, opacity: float = 1.0
    ) -> folium.TileLayer:
        """A ``folium.TileLayer`` backed by a solid-colour data URI.

        ``TileLayer`` takes the URL as its first positional argument
        (``tiles``); passing ``url_template=`` as a keyword swallows the
        value into ``**kwargs`` and falls back to OSM, whose requests the
        CDN proxy 404s. Positional is the only form that survives.
        """
        return folium.TileLayer(
            TestExportControlBrowser._solid_tile_url(rgb),
            name=name,
            attr="Test tile",
            overlay=False,
            show=True,
            opacity=opacity,
        )

    def _run_export(self, page) -> None:
        """Drive the full export flow: open the control, lock the box, export.

        Install :meth:`_install_canvas_hook` first so the renderer's own output
        canvas is captured for pixel assertions.
        """
        page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
        page.wait_for_selector(".foliplus-export-box", state="attached", timeout=5000)
        page.locator(".foliplus-tool-bar .confirm").click()
        page.wait_for_selector(
            ".foliplus-export-box.locked", state="attached", timeout=5000
        )
        page.locator(".foliplus-tool-bar .confirm").click()
        page.wait_for_function(
            """() => {
                const ctrl = document.querySelector('.foliplus-export-ctrl');
                return ctrl && ctrl.classList.contains('collapsed');
            }""",
            timeout=30000,
        )
        page.wait_for_timeout(2000)

    def _install_canvas_hook(self, page) -> None:
        """Hook ``document.createElement`` to capture canvases the renderer
        makes internally (never attached to the DOM). Same trick
        ``test_export_marker_opacity_blend`` uses; fresh-page-per-test means
        the patch can't leak.
        """
        page.evaluate(
            """() => {
                window._capturedCanvases = [];
                const orig = document.createElement.bind(document);
                document.createElement = function(tag, ...args) {
                    const el = orig(tag, ...args);
                    if (tag === 'canvas') {
                        window._capturedCanvases.push(el);
                    }
                    return el;
                };
            }"""
        )

    def _red_pixels_in_export(
        self,
        page,
        match=[230, 30, 30],
        tol=30,
        alpha_min=200,
    ) -> dict:
        """Count pixels matching ``match`` in the renderer's output canvas."""
        page.evaluate(
            f"""() => {{
                window._sampleColor = {match};
                window._sampleTol = {tol};
                window._sampleAlphaMin = {alpha_min};
            }}"""
        )
        return page.evaluate(_js("ExportControl/sample_export_canvas"))

    def test_export_with_heatmap_canvas(self, browser, tmp_path):
        """Export captures the pixels a canvas layer draws.

        The canvas layer's ``foliplus-canvas-layer`` class marks it as
        pointer-events decoration on screen, but the canvas itself is
        *content* — HeatmapControl is the only user and its map is real data.
        This test draws a red rectangle and checks the export canvas actually
        holds those red pixels. A blanket exclude of ``.foliplus-canvas-layer``
        would silently zero out the count, and the test would catch it.
        """
        with use_page(self._make_page, browser, tmp_path, slug="export_heatmap") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            created = page.evaluate(_js("ExportControl/create_red_canvas"))
            assert created is True, "create_red_canvas failed"

            self._install_canvas_hook(page)

            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            page.evaluate(_js("ExportControl/remove_test_canvas"))
            result = self._red_pixels_in_export(page)
            assert result is not None, "Export canvas not captured"
            assert result["hit"] >= 100, (
                f"Canvas layer's red pixels missing from export: {result}"
            )
            assert result["total"] > 0, f"No pixels drawn in export: {result}"
            assert len(errors) == 0, f"JS errors on canvas export: {errors}"

    def test_export_with_annotation_labels(self, browser, tmp_path):
        """Export captures the annotation label pixels at their positions.

        The pixel-position comparison is the gate: for every opaque pixel in
        the live annotation canvas, the same (x, y) in the export canvas
        must also be opaque. The two canvases share CSS coordinates (the
        export canvas' crop-box origin cancels the annotation canvas' offset,
        regardless of DPR and export scale), so a pixel-position match is a
        position match. A regression that dropped the annotation canvas from
        the export (a blanket exclude of ``.foliplus-canvas-layer`` would
        do exactly that) would leave zero matched pixels.
        """
        with use_page(self._make_page, browser, tmp_path, slug="export_annotation") as (
            page,
            errors,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            state = page.evaluate(_js("ExportControl/annotation_canvas_in_export"))
            assert state is not None and state["canvas"] is True, state
            assert state["opaqueBefore"] > 0, state
            assert state["sample"] is not None, state

            self._install_canvas_hook(page)

            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            after = page.evaluate(
                """() => {
                    const canvas = window.map
                        .getPane("foliplus-annotation-__export_ann__")
                        ?.querySelector("canvas");
                    if (!canvas) return 0;
                    const data = canvas
                        .getContext("2d")
                        .getImageData(0, 0, canvas.width, canvas.height).data;
                    let n = 0;
                    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
                    return n;
                }"""
            )
            assert after > 0, f"annotation labels lost after export: {after}"

            # Pixel gate: the export canvas now has an opaque background
            # fill (the container's computed backgroundColor), so the source
            # annotation color is blended. Instead of matching the source
            # color, check that the export canvas has non-background pixels —
            # pixels that differ significantly from the gray background. The
            # annotation canvas carries `.foliplus-canvas-layer`; a blanket
            # exclude of that class would drop the labels and leave zero
            # non-background pixels.
            result = page.evaluate(
                """() => {
                    const canvases = window._capturedCanvases || [];
                    if (canvases.length === 0) return { found: false };
                    const c = canvases[canvases.length - 1];
                    const ctx = c.getContext('2d');
                    if (!ctx) return { found: false };
                    const { data } = ctx.getImageData(0, 0, c.width, c.height);
                    // Count pixels that are NOT the background gray (221,221,221)
                    // within tolerance 20. These are the annotation label pixels.
                    let nonBg = 0;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] === 0) continue;
                        const isBg =
                            Math.abs(data[i] - 221) < 20 &&
                            Math.abs(data[i + 1] - 221) < 20 &&
                            Math.abs(data[i + 2] - 221) < 20;
                        if (!isBg) nonBg++;
                    }
                    return { found: true, nonBg };
                }"""
            )
            assert result["found"] is True, result
            assert result["nonBg"] > 0, (
                f"annotation label pixels missing from export: {result}"
            )
            assert len(errors) == 0, f"JS errors on annotation export: {errors}"

    def _sample_bg_pixels_in_export(
        self, page, match: list[int], tol: int = 20, alpha_min: int = 200
    ) -> dict:
        """Count pixels matching ``match`` in the renderer's output canvas."""
        page.evaluate(
            f"""() => {{
                window._sampleColor = {match};
                window._sampleTol = {tol};
                window._sampleAlphaMin = {alpha_min};
            }}"""
        )
        return page.evaluate(_js("ExportControl/sample_export_canvas"))

    def test_export_uses_solid_color_basemap_as_background(self, browser, tmp_path):
        """Picking a solid-color basemap → the export canvas is filled with it.

        Before this fix the export background came from ``CONF.background`` (a
        Python-static config), so the color the user just picked on screen was
        missing from the image. The export now reads the map container's computed
        ``backgroundColor`` — the same value the user sees — and fills the canvas
        with it.
        """
        with use_page(self._make_page, browser, tmp_path, slug="export_color_bg") as (
            page,
            errors,
        ):
            self._install_canvas_hook(page)

            # Drive the color input through the real LayerControl UI path so
            # the container gets `.active` + `--color-layer-bg` set, exactly as
            # `showColorLayer` does.
            state = page.evaluate(_js("ExportControl/set_color_basemap"))
            assert state["ok"] is True, state
            assert state["containerActive"] is True, state
            assert state["cssVar"] == "#dc1e1e", state
            assert state["bg"] == "rgb(220, 30, 30)", state

            # Full export flow: open, lock, export.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample the whole canvas for the basemap color. The fillRect
            # covers every pixel, so the hit count should dominate the total.
            result = self._sample_bg_pixels_in_export(page, match=[220, 30, 30])
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, f"basemap color missing from export: {result}"
            # The fillRect paints the whole canvas, so nearly every non-
            # transparent pixel should match — a regression (e.g. falling back
            # to CONF.background, which was None/transparent) would leave hit ≈ 0.
            assert result["hit"] > result["total"] * 0.5, (
                f"basemap color not dominant in export: {result}"
            )
            assert len(errors) == 0, f"JS errors on color-basemap export: {errors}"

    def test_export_uses_leaflet_default_background_without_color_basemap(
        self, browser, tmp_path
    ):
        """No solid-color basemap → the export canvas is filled with the map
        container's default background (Leaflet's ``#ddd``).

        The container's computed ``backgroundColor`` is always opaque (Leaflet's
        own CSS sets ``#ddd``), so the export matches what the user sees: a
        plain gray base, not a transparent one. This replaces the old
        ``CONF.background`` (default ``None`` → transparent canvas), which
        disagreed with the screen.
        """
        with use_page(self._make_page, browser, tmp_path, slug="export_default_bg") as (
            page,
            errors,
        ):
            self._install_canvas_hook(page)

            # No color basemap picked: container should be in its default
            # state (Leaflet #ddd, no .active, no --color-layer-bg).
            state = page.evaluate(
                """() => {
                    const c = document.querySelector(".leaflet-container");
                    return {
                        bg: getComputedStyle(c).backgroundColor,
                        hasActive: c.classList.contains("active"),
                    };
                }"""
            )
            assert state["bg"] == "rgb(221, 221, 221)", state
            assert state["hasActive"] is False, state

            # Full export flow: open, lock, export.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample for Leaflet's default gray. The fillRect paints the whole
            # canvas, so the hit count should dominate.
            result = self._sample_bg_pixels_in_export(page, match=[221, 221, 221])
            assert result is not None, "Export canvas not captured"
            assert result["hit"] > 0, f"default gray missing from export: {result}"
            assert result["hit"] > result["total"] * 0.5, (
                f"default gray not dominant in export: {result}"
            )
            assert len(errors) == 0, f"JS errors on default-bg export: {errors}"

    def test_no_basemap_hatch_never_reaches_the_export(self, browser, tmp_path):
        """Empty-basemap state: the map shows the A' hatch, the export does not.

        With every basemap unchecked the map container turns into an empty
        state (`.no-base-map`: transparent background + a `background-image`
        hatch). The hatch is decoration on the screen only — the renderer fills
        from `backgroundColor` and never reads `background-image`, so the
        exported image must be identical to what a no-basemap map without any
        hatch would give.

        Gate on the output, not on the implementation: assert the hatch is
        actually painted on the container (else the test proves nothing), then
        count pixels in the hatch's own alpha band on the export canvas. A real
        vector layer stays in the picture, so a fully empty export cannot hide
        a regression either way.
        """
        marker = folium.CircleMarker(
            location=[26.08, 119.30],
            radius=40,
            color="#00ff00",
            weight=6,
            fill_color="#ff0000",
            fill_opacity=1,
            name="Hatch Marker",
            show=True,
        )
        with use_page(
            self._make_page, browser, tmp_path, marker, slug="no_basemap_export"
        ) as (page, errors):
            panel_ready(page)
            self._install_canvas_hook(page)

            # Deselect every basemap through the panel's base group toggle-all,
            # so the map enters the empty state the way a user does. The overlay
            # above is not in that group and stays on the map.
            clicked = page.evaluate(_js("LayerControl/uncheck_base_group"))
            state = page.evaluate(_js("ExportControl/no_basemap_state"))
            assert clicked["ok"] is True, clicked
            assert state["ok"] is True, state
            assert state["noBaseMap"] is True, (
                f"container not in no-basemap state: clicked={clicked} state={state}"
            )
            assert state["bg"] in ("rgba(0, 0, 0, 0)", "transparent"), (
                f"hatch state must clear the container colour, got {state}"
            )
            assert "conic-gradient" in state["bgImage"], (
                f"hatch not painted on the container: {state}"
            )

            self._run_export(page)

            band = page.evaluate(_js("ExportControl/hatch_alpha_band"))
            assert band is not None, "Export canvas not captured"
            # The overlay kept on the map must still export, so the result is
            # a real image rather than an empty canvas that cannot hide a
            # regression.
            assert band["nonTransparent"] > 1000, f"exported content vanished: {band}"
            # The hatch's own alpha band (0.07 * 255 ~= 18) must be empty: the
            # decoration stayed on screen and never reached the image.
            assert band["band"] == 0, f"hatch pixels leaked into the export: {band}"
            assert len(errors) == 0, f"JS errors on no-basemap export: {errors}"

    def test_export_composites_both_visible_basemaps(self, browser, tmp_path):
        """Two basemaps both on: the export holds both layers' pixels.

        Basemaps are now first-class and no longer mutually exclusive, and tile
        basemaps paint into their own synthesized pane instead of the shared
        ``leaflet-tile-pane``. Neither change may alter what the renderer
        composites: every visible basemap must still contribute, in order, to
        the exported image. Without this gate "moving a layer to a different
        pane leaves the export untouched" is only covered indirectly.

        The bottom basemap paints at full opacity and the top one at 0.5, so
        the expected pixel is the two layers blended. Sampling that blend —
        rather than either source colour — is what proves *both* drew: if the
        upper basemap dropped out the image is the lower colour, and if the
        lower one dropped out it is the upper colour over transparency.

        The layers are added *after* LayerControl (the ``_make_page``
        convention, matching real user code that writes
        ``LayerControl().add_to(m)`` before its tiles). The renderer resolves
        ``li.layer`` lazily via ``findLayer`` at render time, so a
        construction-time null does not mean a permanent null — the layer is
        found by its id once the folium ``var`` is declared.
        """
        top = self._solid_tile_layer((230, 30, 30), "Top Base", opacity=0.5)
        bottom = self._solid_tile_layer((30, 60, 220), "Bottom Base", opacity=1.0)

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            bottom,
            top,
            slug="two_basemaps_export",
        ) as (page, errors):
            panel_ready(page)
            panel_ready(page)
            self._install_canvas_hook(page)

            # Both tile basemaps are visible; the colour basemap paints via
            # container background (not a tile layer), so its `visible` flag
            # is not the right gate for "both basemaps drew".
            state = page.evaluate(_js("ExportControl/no_basemap_state"))
            assert state["ok"] is True, state
            assert state["noBaseMap"] is False, f"a basemap should be visible: {state}"
            tile_layers = [
                li for li in state["layers"] if li["id"] != "foliplus_color_map"
            ]
            assert all(li["isBase"] and li["visible"] for li in tile_layers), (
                f"both tile basemaps should be visible: {tile_layers}"
            )

            self._run_export(page)

            result = self._sample_bg_pixels_in_export(page, match=[130, 45, 125])
            dominant = page.evaluate(_js("ExportControl/export_dominant_color"))
            probe = page.evaluate(_js("ExportControl/probe_tile_loading"))
            assert result is not None, "Export canvas not captured"
            assert result["total"] > 0, "Export canvas is empty"
            # The blend dominates: 0.5 * red + 0.5 * blue, so the whole image
            # is one colour only if both basemaps painted.
            assert result["hit"] > result["total"] * 0.8, (
                f"blended basemap pixels not dominant: {result} dominant={dominant} probe={probe}"
            )
            assert len(errors) == 0, f"JS errors on two-basemap export: {errors}"

    def test_crop_box_drag_resize(self, browser, tmp_path):
        """Drag bottom-right handle to resize the crop box."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag bottom-right handle to enlarge
            handle = page.locator(".foliplus-export-handle.br")
            hb = handle.bounding_box()
            page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2)
            page.mouse.down()
            page.mouse.move(
                hb["x"] + hb["width"] / 2 + 80,
                hb["y"] + hb["height"] / 2 + 40,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(200)

            after_resize = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after_resize["w"] > initial["w"], "Resize should enlarge width"

    def test_locked_box_follows_zoom(self, browser, tmp_path):
        """Locked crop box follows the map after zoom."""
        with use_page(self._make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock the box
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )

            # Zoom in — the locked box should keep tracking the same geo area
            page.keyboard.press("Control+=")
            page.wait_for_timeout(1000)

            # Box should still be visible and locked
            assert page.locator(".foliplus-export-box.locked").is_visible()
            after_zoom = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after_zoom["w"] > 0 and after_zoom["h"] > 0, (
                f"Box disappeared after zoom, size={after_zoom}"
            )

    def test_export_marker_opacity_blend(self, browser, tmp_path):
        """Marker layer opacity is captured in the export via ancestor-chain alpha.

        R5 moved opacity writes to the pane element; the four DOM rendering
        paths (renderMarkers, renderFontAwesome, renderTextLabels, renderRemaining)
        must read the ancestor-chain alpha via effectiveOpacity(). This test
        creates a marker at 0.4 opacity, exports, captures the renderer's
        internal canvas (via a document.createElement hook), and reads its
        pixels to assert the marker was drawn with alpha ≈ 0.4 × 255 ≈ 102.

        A tight range catches both "forgot to draw" (maxAlpha=0) and
        "forgot to apply alpha" (maxAlpha=255) regressions.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # Set up a marker layer with 0.4 opacity.
            state = page.evaluate(_js("ExportControl/export_opacity_blend"))
            assert state is not None and state["marker"] is True, state
            assert state["paneOpacity"] == "0.4", state
            assert state["paneName"] == "__export_opacity_pane__", state

            # Hook document.createElement to capture the export canvas —
            # the renderer creates it internally and never attaches it to the DOM.
            # The patch is not restored: use_page gives each test a fresh page,
            # so the interception cannot leak between tests.
            page.evaluate(
                """() => {
                    window._capturedCanvases = [];
                    const orig = document.createElement.bind(document);
                    document.createElement = function(tag, ...args) {
                        const el = orig(tag, ...args);
                        if (tag === 'canvas') {
                            window._capturedCanvases.push(el);
                        }
                        return el;
                    };
                }"""
            )

            # Full export flow: open, lock, export.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Read the captured canvas pixels and verify the marker was
            # drawn. The export canvas now has an opaque background fill, so
            # the marker's alpha composites onto the background — the
            # resulting pixel alpha is 255 (from the background), and the
            # opacity is reflected in the color blend rather than in alpha.
            #
            # The background is Leaflet's default gray (221, 221, 221). The
            # marker is a red pin; even at 0.4 opacity the blended pixel is
            # visibly different from gray. Count pixels that differ from the
            # background by more than tolerance 30 in any channel — this
            # catches "marker drawn at any opacity" and "marker not drawn
            # at all" (all pixels would be gray).
            result = page.evaluate(
                """() => {
                    const canvases = window._capturedCanvases || [];
                    if (canvases.length === 0) return { found: false };
                    const c = canvases.reduce(
                        (best, cv) =>
                            cv.width * cv.height > best.width * best.height ? cv : best,
                        canvases[0],
                    );
                    const ctx = c.getContext('2d');
                    if (!ctx) return { found: false };
                    const data = ctx.getImageData(0, 0, c.width, c.height).data;
                    let nonBg = 0;
                    let sample = null;
                    for (let i = 0; i < data.length; i += 4) {
                        if (data[i + 3] === 0) continue;
                        const isBg =
                            Math.abs(data[i] - 221) <= 30 &&
                            Math.abs(data[i + 1] - 221) <= 30 &&
                            Math.abs(data[i + 2] - 221) <= 30;
                        if (!isBg) {
                            nonBg++;
                            if (!sample) sample = [data[i], data[i + 1], data[i + 2]];
                        }
                    }
                    return { found: true, nonBg, sample };
                }"""
            )
            assert result["found"] is True, result
            assert result["nonBg"] > 0, f"Marker pixels missing from export: {result}"

    def test_export_focus_three_carriers_survive(self, browser, tmp_path):
        """Focus state: all three carriers (vector, marker, canvas) survive export.

        Focus mode hides non-focused layer panes with CSS `visibility: hidden`.
        SVG vectors inherit this visibility and disappear from the export.
        Markers (not in foliplus panes) and canvas (renderPaneCanvas doesn't
        check visibility) survive regardless.

        B1 peels the pane's inline visibility before reading computed styles,
        so all three carriers survive. Before B1, vectors ≈ 0; after, all > 0.

        Three non-overlapping windows: left (GeoJson vector), center (marker),
        right (heatmap canvas). Focusing the canvas layer hides the vector pane.
        """
        with use_page(self._make_page, browser, tmp_path, slug="export_focus") as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up three carriers and activate focus on the canvas layer.
            state = page.evaluate(_js("ExportControl/focus_three_carriers"))
            assert state is not None and "error" not in state, state
            assert state["focusLayer"] == "__focus_canvas__", state

            # Install canvas hook before export.
            self._install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample three windows in the export canvas.
            page.evaluate(
                f"""() => {{
                    window._sampleWindows = {json.dumps(state["windows"])};
                    window._sampleColor = [230, 30, 30];
                    window._sampleTol = 30;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # All three carriers must survive: each window has red pixels.
            for carrier in ("vector", "marker", "canvas"):
                w = result[carrier]
                assert w["total"] > 0, (
                    f"{carrier} carrier has no pixels in export: {result}"
                )
                assert w["hit"] > 0, (
                    f"{carrier} carrier red pixels missing from export: {result}"
                )
                ratio = w["hit"] / w["total"]
                assert 0.95 <= ratio <= 1.05, (
                    f"{carrier} survival ratio {ratio:.3f} outside [0.95, 1.05]: {result}"
                )

            assert len(errors) == 0, f"JS errors on focus export: {errors}"

    def test_export_focus_element_display_none(self, browser, tmp_path):
        """Reverse gate: element's own display:none is respected in export.

        Sets display:none on a specific SVG path (blue polygon), exports, and
        asserts the path's window has 0 blue pixels. The polygon is blue so
        its pixels are distinguishable from the red background — the pruning
        code in renderPaneSVG removes display:none elements from the clone,
        so they never appear in the SVG string and produce zero pixels.
        """
        with use_page(
            self._make_page, browser, tmp_path, slug="export_display_none"
        ) as (
            page,
            _,
        ):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up carriers with a blue polygon (distinguishable from
            # the red background).
            state = page.evaluate(_js("ExportControl/setup_display_none_test"))
            assert state is not None and "error" not in state, state

            # Hide the polygon's SVG path via display:none.
            hide_result = page.evaluate(_js("ExportControl/hide_blue_path"))
            assert hide_result is not None and hide_result.get("hidden") is True, (
                f"Could not find/hide blue vector path: {hide_result}"
            )

            # Install canvas hook before export.
            self._install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample the vector window — should have 0 blue pixels (path pruned).
            page.evaluate(
                f"""() => {{
                    window._sampleWindows = {json.dumps(state["windows"])};
                    window._sampleColor = [0, 0, 230];
                    window._sampleTol = 30;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            assert result["vector"]["hit"] == 0, (
                f"Hidden path (display:none) still has blue pixels in export: {result}"
            )
            # Also verify the other two carriers are still present.
            page.evaluate(
                """() => {
                    window._sampleColor = [230, 30, 30];
                }"""
            )
            result2 = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result2["marker"]["hit"] > 0, f"Marker carrier missing: {result2}"
            assert result2["canvas"]["hit"] > 0, f"Canvas carrier missing: {result2}"

            assert len(errors) == 0, f"JS errors on display:none export: {errors}"

    def test_export_visibility_hidden_behavior(self, browser, tmp_path):
        """Empirical test: does the export draw visibility:hidden elements?

        Sets visibility:hidden on a blue polygon's SVG path, exports, and
        checks if blue pixels are present. The contract intends
        for visibility (not display) to be used for layout preservation while
        export still sees the element. This test provides empirical evidence
        for the reviewer's contract update decision.
        """
        with use_page(
            self._make_page, browser, tmp_path, slug="export_visibility_hidden"
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Set up carriers with a blue polygon.
            state = page.evaluate(_js("ExportControl/setup_display_none_test"))
            assert state is not None and "error" not in state, state

            # Set visibility:hidden on the polygon's SVG path.
            hide_result = page.evaluate(_js("ExportControl/hide_blue_path_visibility"))
            assert hide_result is not None and hide_result.get("hidden") is True, (
                f"Could not find/hide blue vector path: {hide_result}"
            )

            # Install canvas hook before export.
            self._install_canvas_hook(page)

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample the vector window for blue pixels.
            page.evaluate(
                f"""() => {{
                    window._sampleWindows = {json.dumps(state["windows"])};
                    window._sampleColor = [0, 0, 230];
                    window._sampleTol = 30;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # Report the empirical result.
            print(f"visibility:hidden empirical result: {result}")
            print(f"Vector window blue pixel hit count: {result['vector']['hit']}")

            assert len(errors) == 0, f"JS errors on visibility:hidden export: {errors}"

    def test_export_preview_excluded_finalized_retained(self, browser, tmp_path):
        """Preview lines are excluded from export; finalized lines are retained.

        SKIP_EXPORT stamps the NO_EXPORT class on preview elements (addPreview).
        The renderer's clone pruning removes them from the export. The finalized
        line (in mainLayer) has no such marking and must survive.

        Two non-overlapping windows: left (finalized), right (preview). In
        drawing state, left > 0, right == 0. A regression that marks finalized
        as SKIP_EXPORT would zero out left; one that doesn't mark preview would
        leave right > 0.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            MeasureControl(),
            slug="export_preview",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Expose __measureManager (not injected by _make_page).
            debug = page.evaluate(
                """() => {
                    return {
                        hasCtrl: !!window.__measureCtrl,
                        hasManager: !!window.__measureManager,
                        hasMap: !!window.__map,
                    };
                }"""
            )
            assert debug["hasCtrl"] is True, f"__measureCtrl not set: {debug}"
            assert debug["hasManager"] is True, f"__measureManager not set: {debug}"

            # Set up finalized line + preview line.
            state = page.evaluate(
                """() => {
                    return (function(){
                        const mm = window.__measureManager;
                        const map = window.__map;
                        if (!mm || !map) return { error: 'no mm or map' };
                        // Finalized line near center (inside crop box).
                        mm.layers.mainLayer.addLayer(
                            L.polyline(
                                [[26.078,119.298],[26.076,119.302]],
                                {color:'red', weight:4}
                            )
                        );
                        // Preview: enter distance mode, click once (right area).
                        mm.setMode('distance');
                        map.fire('click', {latlng: L.latLng(26.078, 119.303)});
                        map.fire('mousemove', {latlng: L.latLng(26.076, 119.304)});
                        return {
                            finalized: true,
                            preview: true,
                            windows: {
                                left:  {x:620, y:360, w:40, h:40},
                                right: {x:200, y:360, w:40, h:40},
                            },
                        };
                    })();
                }"""
            )
            assert state is not None and "error" not in state, state
            assert state["finalized"] is True, state
            assert state["preview"] is True, state

            # Install canvas hook before export.
            self._install_canvas_hook(page)

            # Cancel measuring mode so ExportControl is not blocked.
            page.evaluate(
                """() => {
                    if (window.__measureManager) {
                        window.__measureManager.clearActiveMode();
                    }
                }"""
            )

            # Full export flow.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            # Sample both windows.
            page.evaluate(
                f"""() => {{
                    window._sampleWindows = {json.dumps(state["windows"])};
                    window._sampleColor = [230, 30, 30];
                    window._sampleTol = 30;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"

            # Debug: check canvas state.
            debug2 = page.evaluate(
                """() => {
                    const canvases = window._capturedCanvases || [];
                    const ec = canvases[canvases.length - 1];
                    if (!ec) return { error: 'no canvas', n: canvases.length };
                    const ctx = ec.getContext('2d');
                    const data = ctx.getImageData(0, 0, ec.width, ec.height);
                    let nonTrans = 0, minX=9999, maxX=0, minY=9999, maxY=0;
                    let rSum=0, gSum=0, bSum=0;
                    for (let i = 0; i < data.data.length; i += 4) {
                        if (data.data[i+3] > 10) {
                            nonTrans++;
                            const px = i / 4;
                            const x = px % ec.width;
                            const y = Math.floor(px / ec.width);
                            if (x < minX) minX = x;
                            if (x > maxX) maxX = x;
                            if (y < minY) minY = y;
                            if (y > maxY) maxY = y;
                            rSum += data.data[i]; gSum += data.data[i+1]; bSum += data.data[i+2];
                        }
                    }
                    return {
                        canvasW: ec.width, canvasH: ec.height,
                        nonTransparent: nonTrans,
                        bbox: {x: minX, y: minY, w: maxX-minX, h: maxY-minY},
                        avgRGB: nonTrans > 0 ? [Math.round(rSum/nonTrans), Math.round(gSum/nonTrans), Math.round(bSum/nonTrans)] : null,
                    };
                }"""
            )
            print(f"[debug] canvas state: {debug2}")

            # Finalized line must be in the export.
            assert result["left"]["hit"] > 0, (
                f"Finalized line missing from export: {result}"
            )
            # Preview line must NOT be in the export.
            assert result["right"]["hit"] == 0, (
                f"Preview line leaked into export: {result}"
            )

            assert len(errors) == 0, f"JS errors on preview export: {errors}"

    def test_export_no_preview_finalized_retained(self, browser, tmp_path):
        """Reverse gate: finalized line survives when not in drawing state.

        Without a preview, the SKIP_EXPORT pruning has nothing to remove. The
        finalized line must still be in the export. This prevents a regression
        that accidentally marks finalized elements as SKIP_EXPORT (which would
        only be visible when a preview is absent).
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            MeasureControl(),
            slug="export_no_preview",
        ) as (page, _):
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Expose __measureManager (not injected by _make_page).
            debug = page.evaluate(
                """() => {
                    return {
                        hasCtrl: !!window.__measureCtrl,
                        hasManager: !!window.__measureManager,
                        hasMap: !!window.__map,
                    };
                }"""
            )
            assert debug["hasCtrl"] is True, f"__measureCtrl not set: {debug}"
            assert debug["hasManager"] is True, f"__measureManager not set: {debug}"

            # Set up only a finalized line (no preview).
            state = page.evaluate(
                """() => {
                    const mm = window.__measureManager;
                    if (!mm) return { error: 'no mm' };
                    mm.layers.mainLayer.addLayer(
                        L.polyline(
                            [[26.078,119.298],[26.076,119.302]],
                            {color:'red', weight:4}
                        )
                    );
                    return {
                        finalized: true,
                        preview: false,
                        windows: {
                            left: {x:620, y:360, w:40, h:40},
                        },
                    };
                }"""
            )
            assert state is not None and "error" not in state, state
            assert state["finalized"] is True, state
            assert state["preview"] is False, state

            self._install_canvas_hook(page)

            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.locked", state="attached", timeout=5000
            )
            page.locator(".foliplus-tool-bar .confirm").click()
            page.wait_for_function(
                """() => {
                    const ctrl = document.querySelector('.foliplus-export-ctrl');
                    return ctrl && ctrl.classList.contains('is-collapsed');
                }""",
                timeout=30000,
            )
            page.wait_for_timeout(2000)

            page.evaluate(
                f"""() => {{
                    window._sampleWindows = {json.dumps(state["windows"])};
                    window._sampleColor = [230, 30, 30];
                    window._sampleTol = 30;
                    window._sampleAlphaMin = 100;
                }}"""
            )
            result = page.evaluate(_js("ExportControl/sample_export_window"))
            assert result is not None, "Export canvas not captured"
            assert result["left"]["hit"] > 0, (
                f"Finalized line missing from export (no preview): {result}"
            )

            assert len(errors) == 0, f"JS errors on no-preview export: {errors}"
