"""Tests for foliplus.Fullscreen."""

from __future__ import annotations

import folium

from foliplus import Fullscreen


class TestFullscreen:
    def test_default_params(self, base_map: folium.Map):
        from conftest import render
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_hide_self_default(self, base_map: folium.Map):
        from conftest import render
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "hide_self" in html or "true" in html.lower()

    def test_contains_fullscreenchange_listener(self, base_map: folium.Map):
        from conftest import render
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html
