"""Rendered-HTML and CSS assertions for foliplus.FullscreenControl."""

from __future__ import annotations

from conftest import (
    assert_config_value,
    assert_locale,
    read_css,
    render_control,
)

from foliplus import FullscreenControl


class TestFullscreeControlRendering:
    def test_default_params(self):
        html = render_control(FullscreenControl())
        assert "foliplus-fullscreen-toggle" in html

    def test_hide_self_default(self):
        """hide_self=true is passed via CONFIG."""
        html = render_control(FullscreenControl())
        assert_config_value(html, "hide_self", True)

    def test_hide_self_false(self):
        """hide_self=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_self=False))
        assert_config_value(html, "hide_self", False)

    def test_locale_zh(self):
        html = render_control(FullscreenControl(locale="zh"))
        assert_locale(html, "已进入全屏", "FullscreenControl.enter")

    def test_css_fullscreen_variables(self):
        """Fullscreen CSS includes fullscreen container styles."""
        html = render_control(FullscreenControl())
        assert "foliplus-fullscreen-toggle" in html
        assert "ctrl-size" in html
        assert "foliplus-fullscreen-bar" in html

    def test_css_z_index_tokenized(self):
        """Fullscreen z-index 99999 is tokenized, not a magic number in a rule."""
        css = read_css("foliplus/css/FullscreenControl.css")
        assert "var(--foliplus-z-index-fullscreen)" in css
        # The rule uses the token; the literal may only appear in a comment.
        assert "z-index: 99999" not in css

    def test_zoom_svg_inline(self):
        """Zoom +/- use inline SVGs created by FullscreenControl.js."""
        html = render_control(FullscreenControl())
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html

    def test_leaflet_bar_container(self):
        """Container has two-layer structure: outer leaflet-bar, inner fullscreen-bar + ctrl-fold."""
        html = render_control(FullscreenControl())
        assert "leaflet-bar" in html
        assert "leaflet-control" in html
        assert "foliplus-fullscreen-bar" in html
        assert "foliplus-ctrl-fold" in html

    def test_zoom_translation_keys(self):
        """Zoom in/out use translation keys."""
        html = render_control(FullscreenControl())
        assert "FullscreenControl.zoom_in" in html
        assert "FullscreenControl.zoom_out" in html

    def test_hide_others_false_skips_others_block(self):
        """hide_others=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_others=False))
        assert_config_value(html, "hide_others", False)

    def test_hide_self_independent_of_hide_others(self):
        """hide_self still works when hide_others=false."""
        html = render_control(FullscreenControl(hide_self=True, hide_others=False))
        assert_config_value(html, "hide_self", True)
        assert_config_value(html, "hide_others", False)

    def test_zoom_buttons_hidden_with_hide_self(self):
        """hide_self hides zoom +/- together with the fullscreen button."""
        html = render_control(FullscreenControl(hide_self=True, hide_others=False))
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert "foliplus-hidden" in html

    def test_zoom_buttons_visible_without_hide_self(self):
        """hide_self=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_self=False, hide_others=False))
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert_config_value(html, "hide_self", False)
        assert_config_value(html, "hide_others", False)
