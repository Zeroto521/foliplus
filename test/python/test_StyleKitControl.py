"""Tests for foliplus.StyleKitControl."""

from __future__ import annotations

import re

from conftest import (
    assert_config_value,
    assert_locale,
    read_css,
    render_control,
)

from foliplus import StyleKitControl


class TestStyleKitControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert StyleKitControl()._name == "StyleKitControl"

    def test_default_position(self):
        assert StyleKitControl().position == "bottomright"

    def test_custom_position(self):
        assert StyleKitControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert StyleKitControl()._locale_code == ""

    def test_custom_locale(self):
        assert StyleKitControl(locale="zh")._locale_code == "zh"

    def test_no_cdn_dependencies(self):
        """The control ships with the shared runtime only."""
        assert StyleKitControl().default_js == []


class TestStyleKitControlRendering:
    """Rendering output tests (stable across minification)."""

    def test_rendered_content(self):
        """The control renders with its stylesheet and bundle injected."""
        html = render_control(StyleKitControl())
        assert "foliplus-stylekit-ctrl" in html
        assert "<style>" in html
        assert "StyleKitControl" in html

    def test_default_position_config(self):
        """The shared name/position pair is the only control-specific config."""
        html = render_control(StyleKitControl())
        assert_config_value(html, "position", "bottomright")

    def test_custom_position_config(self):
        assert_config_value(render_control(StyleKitControl(position="topleft")), "position", "topleft")

    def test_layout_only_css(self):
        """The stylesheet supplies layout and text alignment only — the button
        recipe, the panel chrome and the icon stroke all stay with the shared
        `common/` stylesheets. A local redefinition of either would drift from
        the four other panel controls.
        """
        css = re.sub(r"/\*.*?\*/", "", read_css("foliplus/css/StyleKitControl.css"), flags=re.S)
        assert ".foliplus-panel-btn" not in css
        assert ".stylekit-action" in css
        assert "stroke" not in css
        assert "color" not in css

    def test_locale_zh(self):
        html = render_control(StyleKitControl(locale="zh"))
        assert_locale(html, "恢复默认", "StyleKitControl.restore_defaults")

    def test_locale_en(self):
        html = render_control(StyleKitControl(locale="en"))
        assert_locale(html, "Restore defaults", "StyleKitControl.restore_defaults")
