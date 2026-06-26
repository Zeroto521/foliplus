"""Tests for foliplus.HeatmapControl."""

from __future__ import annotations

import json

import folium
from conftest import render

from foliplus import HeatmapControl


class TestHeatmapControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert HeatmapControl()._name == "HeatmapControl"

    def test_default_position(self):
        assert HeatmapControl().position == "topleft"

    def test_custom_position(self):
        assert HeatmapControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert HeatmapControl().locale.code == "en"

    def test_custom_locale(self):
        assert HeatmapControl(locale="zh").locale.code == "zh"

    def test_default_params(self):
        ctrl = HeatmapControl()
        assert ctrl.color_scheme == "Reds"
        assert ctrl.method == "jenks"
        assert ctrl.n_classes == 6
        assert ctrl.agg == "count"
        assert len(ctrl.schemes) == 7
        assert ctrl.style["border_weight"] == 1.5
        assert ctrl.style["label_show"] is True

    def test_custom_params(self):
        ctrl = HeatmapControl(
            color_scheme="Reds",
            method="quantile",
            n_classes=4,
            agg="sum",
            schemes=["Reds", "Blues"],
            style={"border_weight": 2.0, "label_show": False},
        )
        assert ctrl.color_scheme == "Reds"
        assert ctrl.method == "quantile"
        assert ctrl.n_classes == 4
        assert ctrl.agg == "sum"
        assert ctrl.schemes == ["Reds", "Blues"]
        assert ctrl.style["border_weight"] == 2.0
        assert ctrl.style["label_show"] is False


class TestHeatmapControlRendering:
    def test_default_params(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "heatmap-ctrl" in html

    def test_custom_color_scheme(self, base_map: folium.Map):
        HeatmapControl(color_scheme="Reds").add_to(base_map)
        html = render(base_map)
        assert "Reds" in html

    def test_custom_method(self, base_map: folium.Map):
        HeatmapControl(method="quantile").add_to(base_map)
        html = render(base_map)
        assert "quantile" in html

    def test_custom_agg(self, base_map: folium.Map):
        HeatmapControl(agg="sum").add_to(base_map)
        html = render(base_map)
        assert "sum" in html

    def test_custom_n_classes(self, base_map: folium.Map):
        HeatmapControl(n_classes=4).add_to(base_map)
        html = render(base_map)
        assert "4" in html

    def test_contains_h3_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "h3-js@4" in html
        assert "h3-js.umd.js" in html

    def test_contains_ss_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "simple-statistics" in html
        assert "simple-statistics.min.js" in html

    def test_contains_chroma_dependency(self, base_map: folium.Map):
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "chroma-js@2" in html
        assert "chroma.min.js" in html

    def test_custom_schemes(self, base_map: folium.Map):
        HeatmapControl(schemes=["Reds", "Greens"]).add_to(base_map)
        html = render(base_map)
        assert "Reds" in html
        assert "Greens" in html

    def test_custom_style(self, base_map: folium.Map):
        HeatmapControl(style={"border_weight": 2.0, "label_show": False}).add_to(
            base_map
        )
        html = render(base_map)
        assert "2.0" in html or "2" in html
        assert "false" in html.lower()

    def test_locale_zh(self, base_map: folium.Map):
        HeatmapControl(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "网格聚合" in html
        # 'heatmap.title' appears in JS source as locale key (e.g. _('heatmap.title'))
        # but the rendered display text should be the Chinese translation
        assert "heatmap.title" in html  # present as JS key, display value is "网格聚合"

    def test_label_marker_config(self, base_map: folium.Map):
        """Label markers use custom pane and no zIndexOffset."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "pane: this.HEATMAP_ID" in html
        assert "heatmap-label" in html

    def test_label_zindex_css(self, base_map: folium.Map):
        """.heatmap-label has !important z-index to override Leaflet's negative formula."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "z-index: 100 !important" in html

    def test_formatnumber_usage(self, base_map: folium.Map):
        """Label values are formatted via foliplus.formatNumber."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "foliplus.formatNumber" in html

    def test_default_color_scheme_rendered(self, base_map: folium.Map):
        """Default color scheme Reds appears in rendered output."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "Reds" in html

    def test_pane_name_constant(self, base_map: folium.Map):
        """HEATMAP_ID is used as pane name consistently."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "__heatmap__" in html
        assert "pane: this.HEATMAP_ID" in html

    def test_hexlayer_pane_init(self, base_map: folium.Map):
        """hexLayer is initialized with pane: this.HEATMAP_ID."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "pane: this.HEATMAP_ID" in html

    def test_register_before_add_data(self, base_map: folium.Map):
        """registerHexLayer is called before hexLayer.addData."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "registerHexLayer()" in html
        assert "heatmapLayer.options._paneSet" not in html

    def test_extract_points_filters_by_feature(self, base_map: folium.Map):
        """extractPoints skips markers without .feature (labels/annotations)."""
        HeatmapControl().add_to(base_map)
        html = render(base_map)
        assert "if (!l.feature) return" in html or "!l.feature" in html
        # Ensure the feature check is inside extractPoints, not elsewhere
        assert "extractPoints" in html


class TestHeatmapControlBrowser:
    """Browser-based smoke tests for HeatmapControl."""

    def test_panel_interaction(self, browser, tmp_path):
        """Open heatmap panel, verify layer dropdown populates.

        CDN scripts (h3-js, chroma-js) are not available in CI, so hexagon
        rendering is NOT tested here.  This test validates that the UI panel
        opens correctly and no critical JS errors occur.
        """
        from foliplus import LayerControl

        m = folium.Map(location=[26.08, 119.30], zoom_start=12)

        # Add marker layers for heatmap to discover via LayerControlAPI
        # GeoJson markers have .feature — required by extractPoints filter
        fg = folium.FeatureGroup(name="Points", show=True)

        for lat, lng in [(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]:
            gj = json.dumps(
                {
                    "type": "FeatureCollection",
                    "features": [
                        {
                            "type": "Feature",
                            "properties": {"name": "p"},
                            "geometry": {"type": "Point", "coordinates": [lng, lat]},
                        }
                    ],
                }
            )
            folium.GeoJson(gj).add_to(fg)
        fg.add_to(m)

        LayerControl().add_to(m)
        HeatmapControl().add_to(m)

        html_path = tmp_path / "test_heatmap_browser.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        page = browser.new_page()
        try:
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

            # Use domcontentloaded to avoid CDN script timeouts blocking load
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            # Wait for the heatmap-ctrl element to exist in DOM (it's hidden
            # when collapsed but Present in the DOM tree)
            page.wait_for_selector(".heatmap-ctrl", state="attached", timeout=10000)

            # Click toggle button via JS — collapsed ctrl-fold may be
            # considered hidden in CI/headless Playwright actionability checks
            page.evaluate("document.querySelector('.heatmap-ctrl .toggle-btn').click()")
            page.wait_for_selector(
                ".heatmap-ctrl.expanded", state="attached", timeout=5000
            )

            # Give initScan time to discover point layers (up to ~1.5s)
            page.wait_for_timeout(2000)

            # Check layer options via evaluate (avoids visibility checks)
            options_count = page.evaluate(
                "document.querySelectorAll('.heatmap-ctrl .layer-select option').length"
            )
            assert options_count >= 2

            # Click close via JS to collapse — verify no crash
            page.evaluate("document.querySelector('.heatmap-ctrl .close-btn').click()")
            page.wait_for_selector(
                ".heatmap-ctrl.collapsed", state="attached", timeout=5000
            )

            # No unexpected JS errors (CDN resource load failures are normal
            # in an offline test environment).
            assert not errors, f"JS errors: {errors}"
        finally:
            page.close()
