"""Browser tests for the folder row UI (folder menu + fold)."""

from __future__ import annotations

import re

import folium
from conftest import _js, load_geojson, make_browser_page, use_page

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestFolderRowBrowser(LayerControlBrowserBase):
    def _page(self, browser, tmp_path):
        fc = load_geojson("LayerControl", "empty_feature_collection")
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        folium.GeoJson(fc, name="Roads", foliplus={"folder": "Roads"}).add_to(m)
        folium.GeoJson(fc, name="Water", foliplus={}).add_to(m)
        LayerControl().add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, "folder_row")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_folder_row_renders_and_folds(self, browser, tmp_path):
        """A declared folder renders a folder row; the chevron folds its members."""
        with use_page(self._page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(400)
            folder_row = page.query_selector(".foliplus-layer-item-folder")
            assert folder_row is not None, "folder row not rendered"
            fk = folder_row.get_attribute("data-folder-key")
            assert fk == "roads", f"expected data-folder-key=roads, got {fk}"
            assert folder_row.get_attribute("data-role") == "overlay"
            member_guide = page.query_selector(
                ".foliplus-layer-item:not(.foliplus-layer-item-folder) .foliplus-layer-rail .foliplus-fold-tree"
            )
            assert member_guide is not None, "member rail lacks fold-tree guide"
            page.click(".foliplus-layer-item-folder .foliplus-layer-fold-btn")
            page.wait_for_timeout(150)
            folded = page.evaluate(_js("LayerControl/count_row_folded"))
            assert folded >= 1, f"expected at least one folded member row, got {folded}"
            assert not errors, f"console errors: {errors}"
