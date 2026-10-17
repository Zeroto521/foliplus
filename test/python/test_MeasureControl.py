"""Tests for foliplus.MeasureControl."""

from __future__ import annotations

import pytest
from conftest import assert_config_value, read_css, render_control

from foliplus import MeasureControl


class TestMeasureControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert MeasureControl()._name == "MeasureControl"

    def test_default_position(self):
        assert MeasureControl().position == "bottomright"

    def test_custom_position(self):
        assert MeasureControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert MeasureControl()._locale_code == ""

    def test_custom_locale(self):
        assert MeasureControl(locale="zh")._locale_code == "zh"

    def test_default_show_bearing(self):
        assert MeasureControl().show_bearing is True

    def test_custom_show_bearing(self):
        assert MeasureControl(show_bearing=False).show_bearing is False

    def test_default_label_show(self):
        assert MeasureControl().label_show is True

    def test_custom_label_show(self):
        assert MeasureControl(label_show=False).label_show is False

    def test_label_show_in_config_fields(self):
        assert "label_show" in MeasureControl._config_fields

    def test_label_show_false_renders_false(self):
        """label_show=False renders false so the JS side hides labels on load."""
        html = render_control(MeasureControl(label_show=False))
        assert_config_value(html, "label_show", False)

    def test_default_label_collide(self):
        assert MeasureControl().label_collide is True

    def test_custom_label_collide(self):
        assert MeasureControl(label_collide=False).label_collide is False

    def test_label_collide_in_config_fields(self):
        assert "label_collide" in MeasureControl._config_fields

    def test_default_export_format(self):
        assert MeasureControl().export_format == "geojson"

    def test_custom_export_format_csv(self):
        assert MeasureControl(export_format="csv").export_format == "csv"

    def test_export_format_in_config_fields(self):
        assert "export_format" in MeasureControl._config_fields

    def test_export_format_combined_with_other_params(self):
        mc = MeasureControl(
            position="topleft",
            show_bearing=False,
            export_format="csv",
        )
        assert mc.position == "topleft"
        assert mc.show_bearing is False
        assert mc.export_format == "csv"

    def test_invalid_export_format_raises(self):
        """Unsupported export_format raises ValueError."""
        with pytest.raises(ValueError, match="export_format"):
            MeasureControl(export_format="invalid")

    def test_export_format_geojson_is_valid(self):
        MeasureControl(export_format="geojson")

    def test_export_format_csv_is_valid(self):
        MeasureControl(export_format="csv")


class TestMeasureControlRendering:
    def test_default_params(self):
        html = render_control(MeasureControl())
        assert "measure-ctrl" in html

    def test_show_bearing_default_true(self):
        """show_bearing defaults to true and renders as JS boolean."""
        html = render_control(MeasureControl())
        assert_config_value(html, "show_bearing", True)

    def test_show_bearing_false(self):
        """show_bearing=False renders false and disables bearing labels."""
        html = render_control(MeasureControl(show_bearing=False))
        assert_config_value(html, "show_bearing", False)

    def test_label_collide_default_true(self):
        """label_collide defaults to true and renders as a JS boolean."""
        html = render_control(MeasureControl())
        assert_config_value(html, "label_collide", True)

    def test_label_collide_false(self):
        """label_collide=False renders false and disables collision detection."""
        html = render_control(MeasureControl(label_collide=False))
        assert_config_value(html, "label_collide", False)

    def test_custom_position(self):
        html = render_control(MeasureControl(position="topleft"))
        assert "topleft" in html

    def test_contains_gcoord_dependency(self):
        html = render_control(MeasureControl())
        assert "gcoord" in html
        assert "gcoord.global.prod.js" in html

    def test_contains_turf_dependency(self):
        html = render_control(MeasureControl())
        assert "turf.min.js" in html

    def test_locale_zh(self):
        html = render_control(MeasureControl(locale="zh"))
        assert "测量工具" in html
        assert "tool_toggle" in html

    def test_css_icon_size_variable(self):
        html = render_control(MeasureControl())
        assert "icon-size-md" in html

    def test_css_stroke_width_emphasis(self):
        html = render_control(MeasureControl())
        assert "stroke-width" in html

    def test_tool_button_class(self):
        """Tool buttons use the tool-btn class."""
        html = render_control(MeasureControl())
        assert "tool-btn" in html

    # ── export_format rendering ──

    def test_export_format_default_geojson(self):
        """export_format defaults to 'geojson' in rendered HTML."""
        html = render_control(MeasureControl())
        assert_config_value(html, "export_format", "geojson")

    def test_export_format_csv(self):
        """export_format='csv' renders the correct value in CONFIG."""
        html = render_control(MeasureControl(export_format="csv"))
        assert_config_value(html, "export_format", "csv")

    def test_export_locale_zh(self):
        """zh locale renders export translation."""
        html = render_control(MeasureControl(locale="zh"))
        assert "tool_export" in html
        assert "导出" in html

    # ── Finish animation tests ──

    def test_dash_sweep_animation_classes(self):
        """Distance finishDist adds foliplus-measure-dash-sweep class with --foliplus-sweep-length."""
        html = render_control(MeasureControl())
        assert "dash-sweep" in html
        assert "--foliplus-sweep-length" in html

    def test_dash_sweep_drop_shadow(self):
        """Dash sweep line has drop-shadow filter for glow effect."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "drop-shadow" in css
        assert "dash-sweep" in css

    def test_ripple_animation_classes(self):
        """Circle finalizeCircle creates a measure-ripple circle with animationend cleanup."""
        html = render_control(MeasureControl())
        assert "measure-ripple" in html
        assert "interactive: false" in html

    def test_ripple_css_variables(self):
        """Ripple duration comes from the motion ladder; its shape parameters
        stay custom properties."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "--foliplus-motion-normal" in css
        assert "--foliplus-ripple-opacity-start" in css
        assert "--foliplus-ripple-stroke-start" in css
        assert "--foliplus-ripple-stroke-end" in css
        assert "measure-ripple" in css

    def test_dash_sweep_css_variables(self):
        """Dash sweep reads its duration from the motion ladder."""

        css = read_css("foliplus/css/MeasureControl.css")
        assert "--foliplus-sweep-length" in css
        assert "--foliplus-motion-fast" in css

    def test_radius_label_has_animation(self):
        """Circle radius label animates in with a decoupled centering transform.

        The radius label's centering transform is stored in a CSS variable
        (--foliplus-label-center) so the animation keyframes reference it instead of
        duplicating the translate values. This keeps centering and animation
        decoupled.
        """
        token_css = read_css("foliplus/css/common/token.css")
        css = read_css("foliplus/css/MeasureControl.css")
        assert "foliplus-measure-label-in-radius" in css
        # Centering transform is defined once in token.css
        assert "--foliplus-label-center: translate(-50%, -50%)" in token_css
        # Keyframes reference the variable, not hardcoded translate values
        assert "transform: var(--foliplus-label-center) scale(0.9)" in css
        assert "transform: var(--foliplus-label-center) scale(1)" in css
        # The radius label class no longer disables animation
        assert (
            "animation: none"
            not in css.split(".foliplus-measure-label-radius")[1].split("/*")[0]
        )

    def test_label_entrances_read_motion_quick(self):
        """Both label entrances read their duration from the motion ladder."""
        css = read_css("foliplus/css/MeasureControl.css")
        assert (
            "animation: foliplus-measure-label-in var(--foliplus-motion-quick)" in css
        )
        assert (
            "animation: foliplus-measure-label-in-radius var(--foliplus-motion-quick)"
            in css
        )


class TestMeasureControlSaveTiming:
    """Marker is persisted before geocode resolves (Python-side check on
    the rendered HTML, no browser needed)."""

    def test_marker_saved_before_geocode(self):
        """Marker measurement is persisted immediately, before geocode resolves."""
        html = render_control(MeasureControl())
        # In the new-marker flow, the measurement is persisted via
        # store.add() BEFORE createLocationMarker() (which triggers the async
        # geocode), so a reload mid-lookup does not lose the marker. Search for
        # the save-then-create pattern within a small window (not the global
        # first occurrence, which may be in restore()).
        create_pos = html.find("createLocationMarker(")
        assert create_pos != -1, "createLocationMarker should exist"
        # Search for store.add within 200 chars BEFORE createLocationMarker
        search_start = max(0, create_pos - 200)
        save_pos = html.find("this.mgr.store.add(", search_start)
        assert save_pos != -1, "store.add() should exist before createLocationMarker"
        gap = create_pos - save_pos
        assert gap < 200, (
            "measurement must be saved right before triggering geocode so a "
            f"reload mid-lookup does not lose the marker (gap={gap})"
        )
