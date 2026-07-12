"""Tests for foliplus.Fullscreen."""

from __future__ import annotations

import folium
from conftest import render

from foliplus import Fullscreen


class TestFullscreenPython:
    """Python-side property tests."""

    def test_name(self):
        assert Fullscreen()._name == "Fullscreen"

    def test_default_position(self):
        assert Fullscreen().position == "bottomright"

    def test_custom_position(self):
        assert Fullscreen(position="topleft").position == "topleft"

    def test_default_hide_self(self):
        assert Fullscreen().hide_self is True

    def test_custom_hide_self(self):
        assert Fullscreen(hide_self=False).hide_self is False

    def test_default_locale(self):
        assert Fullscreen()._LOCALE_CODE == ""

    def test_custom_locale(self):
        assert Fullscreen(locale="zh")._LOCALE_CODE == "zh"


class TestFullscreenRendering:
    def test_default_params(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_hide_self_default(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        # hide_self=True renders as JS: if (true) { ...
        assert "if (true)" in html

    def test_hide_self_false(self, base_map: folium.Map):
        Fullscreen(hide_self=False).add_to(base_map)
        html = render(base_map)
        # hide_self=False renders as JS: if (false) { ...
        assert "if (false)" in html

    def test_contains_fullscreenchange_listener(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "fullscreenchange" in html

    def test_custom_position_renders(self, base_map: folium.Map):
        Fullscreen(position="topleft").add_to(base_map)
        html = render(base_map)
        assert "fullscreen" in html.lower()

    def test_contains_fullscreen_cdn(self, base_map: folium.Map):
        Fullscreen().add_to(base_map)
        html = render(base_map)
        assert "leaflet.fullscreen@3" in html
        assert "Control.FullScreen.min.js" in html
        assert "Control.FullScreen.css" in html

    def test_locale_zh(self, base_map: folium.Map):
        Fullscreen(locale="zh").add_to(base_map)
        html = render(base_map)
        assert "已进入全屏" in html
        assert "Fullscreen.enter" in html
