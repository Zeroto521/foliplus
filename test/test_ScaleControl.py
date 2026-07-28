"""Tests for foliplus.ScaleControl."""

from __future__ import annotations

import folium
import pytest
from conftest import render

from foliplus import ScaleControl


class TestScaleControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ScaleControl()._name == "ScaleControl"

    def test_default_position(self):
        assert ScaleControl().position == "bottomleft"

    def test_custom_position(self):
        with pytest.raises(TypeError):
            ScaleControl(position="topright")

    def test_default_locale(self):
        assert ScaleControl()._locale_code == ""

    def test_custom_locale(self):
        assert ScaleControl(locale="zh")._locale_code == "zh"

    def test_default_params(self):
        ctrl = ScaleControl()
        assert ctrl.metric is True
        assert ctrl.show_zoom is True

    def test_custom_params(self):
        ctrl = ScaleControl(metric=False, show_zoom=False)
        assert ctrl.metric is False
        assert ctrl.show_zoom is False


class TestScaleControlRendering:
    def test_default_params(self, base_map: folium.Map):
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "scale-wrap" in html

    def test_metric_default(self, base_map: folium.Map):
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "metric" in html.lower()

    def test_metric_false_still_renders(self, base_map: folium.Map):
        ScaleControl(metric=False).add_to(base_map)
        html = render(base_map)
        assert "leaflet-control-scale" in html

    def test_show_zoom(self, base_map: folium.Map):
        ScaleControl(show_zoom=True).add_to(base_map)
        html = render(base_map)
        assert "scale-zoom-label" in html
        assert "zoomend" in html

    def test_hide_zoom(self, base_map: folium.Map):
        ScaleControl(show_zoom=False).add_to(base_map)
        html = render(base_map)
        assert "const zoomLabel" not in html
        assert "zoomend" not in html

    def test_locale_zh(self, base_map: folium.Map):
        ScaleControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "地图级别" in html
        assert "ScaleControl.zoom_label" in html

    def test_imperial_false_in_output(self, base_map: folium.Map):
        """Scale control outputs imperial: false (metric-only)."""
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "imperial: false" in html

    def test_metric_false_disables_metric(self, base_map: folium.Map):
        """metric=false correctly passed to Leaflet."""
        ScaleControl(metric=False).add_to(base_map)
        html = render(base_map)
        assert "metric: false" in html

    def test_zoom_label_format(self, base_map: folium.Map):
        """Zoom label uses ScaleControl.zoom_label key with {zoom} placeholder."""
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "ScaleControl.zoom_label" in html
        assert "{zoom}" in html

    def test_zoom_end_event(self, base_map: folium.Map):
        """Zoom label updates on zoomend event."""
        ScaleControl(show_zoom=True).add_to(base_map)
        html = render(base_map)
        assert 'map.on("zoomend", updateZoom)' in html

    def test_unload_cleanup_zoom(self, base_map: folium.Map):
        """Zoom listener removed on map unload."""
        ScaleControl(show_zoom=True).add_to(base_map)
        html = render(base_map)
        assert (
            'this._map.on("unload", () => this._map.off("zoomend", updateZoom))' in html
        )

    def test_scale_position_bottomleft(self, base_map: folium.Map):
        """Position is bottomleft (Leaflet default for scale)."""
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "bottomleft" in html

    def test_both_disabled(self, base_map: folium.Map):
        """scale still renders with metric=False and show_zoom=False."""
        ScaleControl(metric=False, show_zoom=False).add_to(base_map)
        html = render(base_map)
        assert "foliplus-scale-wrap" in html
        assert "leaflet-control-scale" in html
        assert "const zoomLabel" not in html

    def test_common_css_injected(self, base_map: folium.Map):
        """Common design tokens are injected into the page."""
        ScaleControl().add_to(base_map)
        html = render(base_map)
        assert "--ctrl-bg" in html
        assert "foliplus-scale-wrap" in html


class TestScaleControlBrowser:
    """Browser-based smoke tests for ScaleControl."""

    def _make_page(self, browser, tmp_path, show_zoom=True, metric=True):
        """Build page with ScaleControl."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ScaleControl(show_zoom=show_zoom, metric=metric).add_to(m)

        html = m.get_root().render()
        html_path = tmp_path / "scale_browser.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        errors = []
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
        page.wait_for_selector(".foliplus-scale-wrap", state="attached", timeout=10000)
        return page, errors

    def test_scale_visible(self, browser, tmp_path):
        """Scale wrap is visible in the DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            visible = page.evaluate(
                "document.querySelector('.foliplus-scale-wrap') !== null"
            )
            assert visible
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_zoom_label_visible(self, browser, tmp_path):
        """Zoom label is visible when show_zoom=True."""
        page, errors = self._make_page(browser, tmp_path, show_zoom=True)
        try:
            has_label = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label') !== null"
            )
            assert has_label
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_zoom_label_hidden_when_disabled(self, browser, tmp_path):
        """Zoom label is absent when show_zoom=False."""
        page, errors = self._make_page(browser, tmp_path, show_zoom=False)
        try:
            has_label = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label') !== null"
            )
            assert not has_label
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_scale_leaflet_class(self, browser, tmp_path):
        """Scale has leaflet-control-scale class in DOM."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            has_class = page.evaluate(
                "document.querySelector('.leaflet-control-scale') !== null"
            )
            assert has_class
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_scale_shows_metric_text(self, browser, tmp_path):
        """Scale line displays metric units (km/m)."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            scale_text = page.evaluate(
                "document.querySelector('.leaflet-control-scale-line')?.textContent"
            )
            assert scale_text
            assert any(u in scale_text for u in ["km", "m"])
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_zoom_label_text(self, browser, tmp_path):
        """Zoom label shows 'Zoom Level: N' format."""
        page, errors = self._make_page(browser, tmp_path, show_zoom=True)
        try:
            label_text = page.evaluate(
                "document.querySelector('.foliplus-scale-zoom-label')?.textContent"
            )
            assert label_text
            assert "Zoom Level" in label_text or "地图级别" in label_text
            assert any(c.isdigit() for c in label_text)
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_no_console_errors(self, browser, tmp_path):
        """Scale control produces no JS console errors."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            assert not errors, f"JS console errors: {errors}"
        finally:
            page.close()

    # ── Visual alignment with attribution ──────────────────────────────────

    def test_height_matches_attribution(self, browser, tmp_path):
        """Scale wrap height equals attribution height."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            heights = page.evaluate("""() => {
                const s = document.querySelector('.foliplus-scale-wrap');
                const a = document.querySelector('.leaflet-control-attribution');
                if (!s || !a) return null;
                return {
                    scale: s.getBoundingClientRect().height,
                    attr: a.getBoundingClientRect().height,
                };
            }""")
            assert heights is not None, "scale-wrap or attribution not found"
            assert heights["scale"] == heights["attr"], (
                f"height mismatch: scale={heights['scale']}px attr={heights['attr']}px"
            )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_font_matches_attribution(self, browser, tmp_path):
        """Scale line and zoom label font matches attribution font."""
        page, errors = self._make_page(browser, tmp_path, show_zoom=True)
        try:
            fonts = page.evaluate("""() => {
                const sl = document.querySelector('.leaflet-control-scale-line');
                const zl = document.querySelector('.foliplus-scale-zoom-label');
                const a = document.querySelector('.leaflet-control-attribution');
                if (!sl || !a) return null;
                const acs = getComputedStyle(a);
                const slcs = getComputedStyle(sl);
                const zlcs = zl ? getComputedStyle(zl) : null;
                return {
                    attr: {
                        family: acs.fontFamily.split(',')[0].trim(),
                        size: acs.fontSize,
                        weight: acs.fontWeight,
                    },
                    scaleLine: {
                        family: slcs.fontFamily.split(',')[0].trim(),
                        size: slcs.fontSize,
                        weight: slcs.fontWeight,
                    },
                    zoomLabel: zlcs ? {
                        family: zlcs.fontFamily.split(',')[0].trim(),
                        size: zlcs.fontSize,
                        weight: zlcs.fontWeight,
                    } : null,
                };
            }""")
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
        finally:
            page.close()

    def test_line_height_matches_attribution(self, browser, tmp_path):
        """Scale wrap and zoom label line-height matches attribution."""
        page, errors = self._make_page(browser, tmp_path, show_zoom=True)
        try:
            lh = page.evaluate("""() => {
                const s = document.querySelector('.foliplus-scale-wrap');
                const zl = document.querySelector('.foliplus-scale-zoom-label');
                const a = document.querySelector('.leaflet-control-attribution');
                if (!s || !a) return null;
                return {
                    wrap: getComputedStyle(s).lineHeight,
                    attr: getComputedStyle(a).lineHeight,
                    zoomLabel: zl ? getComputedStyle(zl).lineHeight : null,
                };
            }""")
            assert lh is not None, "elements not found"
            assert lh["wrap"] == lh["attr"], (
                f"wrap line-height mismatch: {lh['wrap']} vs {lh['attr']}"
            )
            if lh["zoomLabel"]:
                assert lh["zoomLabel"] == lh["attr"], (
                    f"zoom-label line-height mismatch: {lh['zoomLabel']} vs {lh['attr']}"
                )
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()

    def test_scale_line_has_bottom_border(self, browser, tmp_path):
        """Scale line has a visible bottom border (horizontal line)."""
        page, errors = self._make_page(browser, tmp_path)
        try:
            border = page.evaluate("""() => {
                const el = document.querySelector('.leaflet-control-scale-line');
                if (!el) return null;
                const cs = getComputedStyle(el);
                return {
                    bottomWidth: cs.borderBottomWidth,
                    bottomStyle: cs.borderBottomStyle,
                    bottomColor: cs.borderBottomColor,
                };
            }""")
            assert border is not None, "scale-line not found"
            assert float(border["bottomWidth"].replace("px", "")) > 0, (
                f"bottom border has no width: {border['bottomWidth']}"
            )
            assert border["bottomStyle"] != "none", "bottom border style is 'none'"
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
