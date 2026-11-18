"""Tile gridline tests for foliplus.LayerControl.

A host page stylesheet that loads after Leaflet's can revert tile <img> to
inline, which puts the baseline gap back under every tile row — visible as
white gridlines. reset.css restates Leaflet's own
`.leaflet-container img { display: block }` rule so the cascade keeps block
display whatever the host's stylesheet order is.
"""

from __future__ import annotations

import folium
from conftest import _js, make_browser_page, read_css, use_page

from foliplus import LayerControl

# The host reset under test: RTD's normalize lowers tile <img> back to inline.
# Injected *after* the map boots, so it is the losing half of the real order.
_HOST_RESET = "img { display: inline; }"


class TestTileGridline:
    """The re-stated rule ships, so a host reset cannot win the cascade."""

    def test_reset_restates_tile_img_display(self):
        css = read_css("foliplus/css/common/reset.css")
        rule = css[css.index(".leaflet-container img") :]
        rule = rule[: rule.index("}")]
        assert "display: block" in rule


class TestTileGridlineBrowser:
    """Computed tile <img> display survives a late host reset."""

    @staticmethod
    def _probe(browser, tmp_path, slug="tile_gridline"):
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        page.add_style_tag(content=_HOST_RESET)
        return page, errors

    def test_tile_img_display_survives_host_reset(self, browser, tmp_path):
        """The host reset arrives last, yet the tiles still render block."""
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            assert errors == [], f"page errors: {errors}"
            r = page.evaluate(_js("LayerControl/read_tile_img_display"))
            assert r is not None, "probe returned nothing"
            assert r["ok"], f"tile <img> not block: {r}"
