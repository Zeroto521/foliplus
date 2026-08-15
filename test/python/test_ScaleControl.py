"""Tests for foliplus.ScaleControl."""

from __future__ import annotations

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    make_browser_page,
    render_control,
    use_page,
)

from foliplus import ScaleControl


class TestScaleControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ScaleControl()._name == "ScaleControl"

    def test_default_position(self):
        assert ScaleControl().position == "bottomleft"

    def test_position_fixed_to_bottomleft(self):
        """ScaleControl position is always bottomleft; passing position raises TypeError."""
        with pytest.raises(TypeError):
            ScaleControl(position="topright")

    def test_default_locale(self):
        assert ScaleControl()._locale_code == ""

    def test_custom_locale(self):
        assert ScaleControl(locale="zh")._locale_code == "zh"

    def test_default_params(self):
        ctrl = ScaleControl()
        assert ctrl.unit == "metric"
        assert ctrl.show_zoom is True

    def test_custom_params(self):
        ctrl = ScaleControl(unit="imperial", show_zoom=False)
        assert ctrl.unit == "imperial"
        assert ctrl.show_zoom is False

    def test_invalid_unit_raises(self):
        """Invalid unit value raises ValueError."""
        with pytest.raises(ValueError, match="unit must be "):
            ScaleControl(unit="invalid")


class TestScaleControlRendering:
    def test_default_params(self):
        html = render_control(ScaleControl())
        assert "scale-wrap" in html

    def test_metric_default(self):
        html = render_control(ScaleControl())
        assert_config_value(html, "isMetric", True)

    def test_metric_false_still_renders(self):
        html = render_control(ScaleControl(unit="imperial"))
        assert "leaflet-control-scale-line" in html

    def test_show_zoom(self):
        html = render_control(ScaleControl(show_zoom=True))
        assert "scale-zoom-label" in html
        assert "zoomend" in html

    def test_hide_zoom(self):
        html = render_control(ScaleControl(show_zoom=False))
        assert_config_value(html, "show_zoom", False)

    def test_locale_zh(self):
        html = render_control(ScaleControl(locale="zh"))
        assert_locale(html, "地图级别", "ScaleControl.zoom_label")

    def test_metric_false_disables_metric(self):
        """unit='imperial' correctly passed to Leaflet."""
        html = render_control(ScaleControl(unit="imperial"))
        assert_config_value(html, "isMetric", False)

    def test_zoom_label_format(self):
        """Zoom label uses ScaleControl.zoom_label key with {zoom} placeholder."""
        html = render_control(ScaleControl())
        assert "ScaleControl.zoom_label" in html
        assert "{zoom}" in html

    def test_scale_position_bottomleft(self):
        """Position is bottomleft (Leaflet default for scale)."""
        html = render_control(ScaleControl())
        assert "bottomleft" in html

    def test_both_disabled(self):
        """scale still renders with unit='imperial' and show_zoom=False."""
        html = render_control(ScaleControl(unit="imperial", show_zoom=False))
        assert "foliplus-scale-wrap" in html
        assert_config_value(html, "isMetric", False)

    def test_common_css_injected(self):
        """Common design tokens are injected into the page."""
        html = render_control(ScaleControl())
        assert "--ctrl-bg" in html
        assert "foliplus-scale-wrap" in html


class TestScaleControlBrowser:
    """Browser-based smoke tests for ScaleControl."""

    def _make_page(self, browser, tmp_path, show_zoom=True, unit="metric"):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ScaleControl(show_zoom=show_zoom, unit=unit).add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "scale")
        page.wait_for_selector(".foliplus-scale-wrap", state="attached", timeout=10000)
        return page, errors

    def test_scale_visible(self, browser, tmp_path):
        """Scale wrap is visible in the DOM."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            visible = page.evaluate(
                "document.querySelector('.foliplus-scale-wrap') !== null"
            )
            assert visible
            assert not errors, f"JS errors: {errors}"

    def test_zoom_label_visible(self, browser, tmp_path):
        """Zoom label is visible when show_zoom=True."""
        with use_page(self._make_page, browser, tmp_path, show_zoom=True) as (
            page,
            errors,
        ):
            has_label = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label') !== null"
            )
            assert has_label
            assert not errors, f"JS errors: {errors}"

    def test_zoom_label_hidden_when_disabled(self, browser, tmp_path):
        """Zoom label is absent when show_zoom=False."""
        with use_page(self._make_page, browser, tmp_path, show_zoom=False) as (
            page,
            errors,
        ):
            has_label = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label') !== null"
            )
            assert not has_label
            assert not errors, f"JS errors: {errors}"

    def test_scale_leaflet_class(self, browser, tmp_path):
        """Scale has leaflet-control-scale-line class in DOM."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            has_class = page.evaluate(
                "document.querySelector('.leaflet-control-scale-line') !== null"
            )
            assert has_class
            assert not errors, f"JS errors: {errors}"

    def test_scale_shows_metric_text(self, browser, tmp_path):
        """Scale line displays metric units (km/m)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            scale_text = page.evaluate(
                "document.querySelector('.leaflet-control-scale-line')?.textContent"
            )
            assert scale_text
            assert any(u in scale_text for u in ["km", "m"])
            assert not errors, f"JS errors: {errors}"

    def test_scale_shows_imperial_text(self, browser, tmp_path):
        """Scale line displays imperial units (mi/ft)."""
        with use_page(self._make_page, browser, tmp_path, unit="imperial") as (
            page,
            errors,
        ):
            scale_text = page.evaluate(
                "document.querySelector('.leaflet-control-scale-line')?.textContent"
            )
            assert scale_text
            assert any(u in scale_text for u in ["mi", "ft"])
            assert not errors, f"JS errors: {errors}"

    def test_zoom_label_text(self, browser, tmp_path):
        """Zoom label shows 'Zoom Level: N' format."""
        with use_page(self._make_page, browser, tmp_path, show_zoom=True) as (
            page,
            errors,
        ):
            label_text = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label')?.textContent"
            )
            assert label_text
            assert "Zoom Level" in label_text or "地图级别" in label_text
            assert any(c.isdigit() for c in label_text)
            assert not errors, f"JS errors: {errors}"

    def test_no_console_errors(self, browser, tmp_path):
        """Scale control produces no JS console errors."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            assert not errors, f"JS console errors: {errors}"

    # ── Visual alignment with attribution ──────────────────────────────────

    def test_height_matches_attribution(self, browser, tmp_path):
        """Scale wrap height equals attribution height."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            heights = page.evaluate(_js("ScaleControl/read_heights"))
            assert heights is not None, "scale-wrap or attribution not found"
            assert heights["scale"] == heights["attr"], (
                f"height mismatch: scale={heights['scale']}px attr={heights['attr']}px"
            )
            assert not errors, f"JS errors: {errors}"

    def test_font_matches_attribution(self, browser, tmp_path):
        """Scale line and zoom label font matches attribution font."""
        with use_page(self._make_page, browser, tmp_path, show_zoom=True) as (
            page,
            errors,
        ):
            fonts = page.evaluate(_js("ScaleControl/read_fonts"))
            assert fonts is not None, "elements not found"
            attr = fonts["attr"]
            sl = fonts["scaleLine"]
            # Font family (primary name) matches
            assert sl["family"] == attr["family"], (
                f"font-family mismatch: {sl['family']} vs {attr['family']}"
            )
            # Font size matches
            assert sl["size"] == attr["size"], (
                f"font-size mismatch: {sl['size']} vs {attr['size']}"
            )
            # Font weight matches
            assert sl["weight"] == attr["weight"], (
                f"font-weight mismatch: {sl['weight']} vs {attr['weight']}"
            )
            # Zoom label also matches if present
            if fonts["zoomLabel"]:
                zl = fonts["zoomLabel"]
                assert zl["family"] == attr["family"]
                assert zl["size"] == attr["size"]
                assert zl["weight"] == attr["weight"]
            assert not errors, f"JS errors: {errors}"

    def test_line_height_matches_attribution(self, browser, tmp_path):
        """Scale wrap and zoom label line-height matches attribution."""
        with use_page(self._make_page, browser, tmp_path, show_zoom=True) as (
            page,
            errors,
        ):
            lh = page.evaluate(_js("ScaleControl/read_line_heights"))
            assert lh is not None, "elements not found"
            assert lh["wrap"] == lh["attr"], (
                f"wrap line-height mismatch: {lh['wrap']} vs {lh['attr']}"
            )
            if lh["zoomLabel"]:
                assert lh["zoomLabel"] == lh["attr"], (
                    f"zoom-label line-height mismatch: {lh['zoomLabel']} vs {lh['attr']}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_scale_line_has_bottom_border(self, browser, tmp_path):
        """Scale line has a visible bottom border (horizontal line)."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            border = page.evaluate(_js("ScaleControl/read_border"))
            assert border is not None, "scale-line not found"
            assert float(border["bottomWidth"].replace("px", "")) > 0, (
                f"bottom border has no width: {border['bottomWidth']}"
            )
            assert border["bottomStyle"] != "none", "bottom border style is 'none'"
            assert not errors, f"JS errors: {errors}"
