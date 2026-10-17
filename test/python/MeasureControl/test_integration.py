"""Integration tests for foliplus.MeasureControl."""

from __future__ import annotations

import folium
from conftest import _js, make_browser_page, use_page

from foliplus import MeasureControl
from foliplus._cdn_loader import load_cdn

from .helper import _stub_cdn, _TURF_STUB


class TestMeasureIntegrationBrowser:
    def test_works_without_layercontrol(self, browser, tmp_path):
        """MeasureControl initializes without LayerControl (degradation)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        MeasureControl().add_to(m)

        html = m.get_root().render()
        html = _stub_cdn(html, {"turf": _TURF_STUB})
        with use_page(
            make_browser_page, browser, tmp_path, html, "measure_no_layer"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-measure-ctrl", state="attached", timeout=10000
            )
            ctrl = page.evaluate(_js("MeasureControl/read_measure_ctrl"))
            assert ctrl is not None, "MeasureControl DOM should exist"
            assert not errors, f"JS errors: {errors}"
