"""Tests for foliplus.base — BaseControl."""

from __future__ import annotations

import folium
from conftest import render


class TestBaseControlRendering:
    def test_includes_common_css(self, base_map: folium.Map):
        from foliplus import MapSearch

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "--ctrl-bg" in html

    def test_includes_runtime_js(self, base_map: folium.Map):
        from foliplus import MapSearch

        MapSearch().add_to(base_map)
        html = render(base_map)
        assert "foliplus.resolveLocale(" in html
        # Verify locale tables are passed inline (not as a separate variable)
        assert '"locale.name": "English"' in html
        assert '"locale.name": "中文"' in html
