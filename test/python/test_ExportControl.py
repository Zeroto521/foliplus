"""Tests for foliplus.ExportControl."""

from __future__ import annotations

import json
import re

import pytest
from conftest import (
    render_control,
)

from foliplus import ExportControl


class TestExportControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert ExportControl()._name == "ExportControl"

    def test_default_position(self):
        assert ExportControl().position == "bottomright"

    def test_custom_position(self):
        assert ExportControl(position="topleft").position == "topleft"

    def test_default_args(self):
        ctrl = ExportControl()
        assert ctrl.filename == "map"
        assert ctrl.format == "png"
        assert ctrl.quality == 0.92
        assert ctrl.scale == 2.0
        assert ctrl.timeout == 7500

    def test_custom_args(self):
        ctrl = ExportControl(
            filename="my_map",
            format="jpeg",
            quality=0.8,
            scale=3.5,
            timeout=10000,
        )
        assert ctrl.filename == "my_map"
        assert ctrl.format == "jpeg"
        assert ctrl.quality == 0.8
        assert ctrl.scale == 3.5
        assert ctrl.timeout == 10000

    def test_default_locale(self):
        assert ExportControl()._locale_code == ""

    def test_custom_locale(self):
        assert ExportControl(locale="zh")._locale_code == "zh"

    def test_all_positions(self):
        for pos in ("topleft", "topright", "bottomleft", "bottomright"):
            assert ExportControl(position=pos).position == pos

    def test_edge_scale_values(self):
        assert ExportControl(scale=1.0).scale == 1.0
        assert ExportControl(scale=3.0).scale == 3.0

    def test_timeout_zero(self):
        assert ExportControl(timeout=0).timeout == 0

    def test_invalid_position_raises(self):
        """Position is validated by BaseControl, so every control inherits it."""
        with pytest.raises(ValueError, match="position must be one of"):
            ExportControl(position="center")

    def test_quality_above_range_raises(self):
        with pytest.raises(
            ValueError, match="quality must be a number between 0.0 and 1.0"
        ):
            ExportControl(quality=1.5)

    def test_quality_below_range_raises(self):
        with pytest.raises(
            ValueError, match="quality must be a number between 0.0 and 1.0"
        ):
            ExportControl(quality=-0.1)

    def test_scale_must_be_positive(self):
        with pytest.raises(ValueError, match="scale must be a positive number"):
            ExportControl(scale=0)

    def test_negative_timeout_raises(self):
        with pytest.raises(ValueError, match=r"timeout must be an int >= 0"):
            ExportControl(timeout=-1)

    def test_zero_max_pixels_raises(self):
        with pytest.raises(ValueError, match="max_pixels must be a positive int"):
            ExportControl(max_pixels=0)

    def test_numpy_scalars_are_accepted(self):
        """numpy scalars are not int/float subclasses, yet they must pass."""
        numpy = pytest.importorskip("numpy")
        ctrl = ExportControl(quality=numpy.float64(0.5), timeout=numpy.int64(100))
        assert ctrl.quality == 0.5
        assert ctrl.timeout == 100

    def test_format_default(self):
        assert ExportControl().format == "png"

    def test_format_jpeg(self):
        assert ExportControl(format="jpeg").format == "jpeg"

    def test_format_webp(self):
        assert ExportControl(format="webp").format == "webp"

    def test_format_geotiff(self):
        assert ExportControl(format="geotiff").format == "geotiff"

    def test_format_invalid_raises(self):
        with pytest.raises(ValueError, match="format must be one of"):
            ExportControl(format="gif")

    def test_quality_default(self):
        assert ExportControl().quality == 0.92

    def test_quality_custom(self):
        assert ExportControl(quality=0.5).quality == 0.5

    def test_max_pixels_default(self):
        assert ExportControl().max_pixels == 10240000

    def test_max_pixels_none(self):
        assert ExportControl(max_pixels=None).max_pixels is None

    def test_max_pixels_custom(self):
        assert ExportControl(max_pixels=1000000).max_pixels == 1000000

    def test_locale_config_bare_has_no_custom_strings(self):
        """A bare LocaleConfig records the code but ships no custom table.

        The code is sent to JS, which ships the built-in tables via
        _COMPONENT_TABLES and lets the browser pick the language — so this
        asserts the *absence* of a custom table rather than that translation
        took effect.
        """
        from foliplus.locale import LocaleConfig

        cfg = LocaleConfig(language="zh")
        ctrl = ExportControl(locale=cfg)
        assert ctrl._locale_code == "zh"
        config = json.loads(ctrl._config_block)
        assert config["locale_code"] == "zh"
        # Built-in tables are in the shared bundle, not per-instance CONFIG.
        assert config["locale_tables"] == {}


class TestExportControlRendering:
    def test_default_params(self):
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "ctrl-fold" in html

    def test_custom_params_rendering(self):
        html = render_control(
            ExportControl(
                filename="custom",
                format="jpeg",
                quality=0.8,
                scale=1.5,
                timeout=5000,
            )
        )
        assert "custom" in html
        assert "jpeg" in html

    def test_geotiff_format_in_html(self):
        """geotiff format is passed through to the HTML template."""
        html = render_control(ExportControl(format="geotiff"))
        assert "geotiff" in html

    def test_css_loaded(self):
        """ExportControl CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-overlay" in html
        assert "foliplus-export-box" in html
        assert "foliplus-export-handle" in html
        assert "foliplus-export-center" in html
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html
        assert "foliplus-hidden" in html

    def test_css_z_index_pattern(self):
        """CSS uses --foliplus-z-export-base variable with calc()."""
        html = render_control(ExportControl())
        assert "z-export-base" in html
        assert "calc(" in html

    def test_css_top_z_index_tokenized(self):
        """The 100000 'above everything' z-index is a token, not a magic number in a rule."""
        from conftest import read_css

        css = read_css("foliplus/css/ExportControl.css")
        assert "var(--foliplus-z-index-top)" in css
        # The rule uses the token; the literal may only appear in a comment.
        assert "z-index: 100000" not in css

    def test_css_scale_z_in_export_ladder(self):
        """scale/attr z rides the export ladder (export-base - 10), not the layer band.

        T241 conflict: `--foliplus-export-scale-z: 850` sat inside the layer-z
        band (Z_INDEX.BASE 600 + STEP 10), so a ~25-layer overlay stack climbed
        past it and covered the scale control. The dim layer belongs above all
        data layers and under the crop UI — `calc(export-base - 10)` = 9490.
        """
        from conftest import read_css

        css = read_css("foliplus/css/common/token.css")
        assert (
            "--foliplus-export-scale-z: calc(var(--foliplus-z-export-base) - 10);"
            in css
        )
        # The old layer-band value must not survive in the token assignment.
        assert "--foliplus-export-scale-z: 850" not in css

    def test_locale_zh(self):
        html = render_control(ExportControl(locale="zh"))
        assert "导出" in html
        assert "ExportControl.btn_title" in html

    def test_del_icon_exclusion(self):
        """del-icon elements are excluded via data-foliplus-export attribute."""
        html = render_control(ExportControl())
        assert 'data-foliplus-export="exclude"' in html

    def test_export_control_py_file(self):
        """ExportControl.py has expected exports."""
        ctrl = ExportControl()
        assert hasattr(ctrl, "filename")
        assert hasattr(ctrl, "scale")
        assert hasattr(ctrl, "timeout")
        assert hasattr(ctrl, "position")
        assert hasattr(ctrl, "_template")

    def test_css_preview_present(self):
        """ExportControl preview CSS classes are present."""
        html = render_control(ExportControl())
        assert "foliplus-export-ctrl" in html
        assert "foliplus-export-preview" in html

    def test_crop_handle_hover_active(self):
        """Handles warm to accent-light and pick up the slider glow on press.

        Cursor direction is the existing grab affordance and stays untouched;
        hover/press only add surface feedback. Transform is reserved for the
        per-edge translate, so press feedback is background/shadow only.
        Component CSS stays in ExportControl.css.
        """
        from conftest import read_css

        css = read_css("foliplus/css/ExportControl.css")
        # Nested source form: .foliplus-export-handle { &:is(:hover, :active) }
        assert ".foliplus-export-handle" in css
        assert "&:is(:hover, :active)" in css
        assert "background: var(--foliplus-accent-light)" in css
        assert "var(--foliplus-slider-thumb-glow)" in css
        # Direction cursors are the grab affordance and must survive.
        assert "cursor: nwse-resize" in css
        assert "cursor: nesw-resize" in css
        assert "cursor: ns-resize" in css
        assert "cursor: ew-resize" in css
        # Geometry + interaction — no live scale().
        live = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        assert "scale(" not in live
        # Round radius so hover wash / glow do not paint square corners.
        assert "border-radius: var(--foliplus-radius-round)" in css
        # Explicit transition list — a bare token shorthand would also
        # animate the per-edge translate (top/left/transform).
        assert "transition: var(--foliplus-transition-fast)" not in live
        assert (
            "background-color var(--foliplus-transition-fast)" in live
            and "box-shadow var(--foliplus-transition-fast)" in live
        )

    def test_crop_box_and_center_hover_active(self):
        """Box deepens its glow; center answers with glow only — no scale.

        Locked boxes hide handles/center and set pointer-events: none, so they
        never light. Center must not scale: scale() composed with
        translate(-50%, -50%) shifts the dot on hover.
        """
        from conftest import read_css

        css = read_css("foliplus/css/ExportControl.css")
        assert "&:not(.foliplus-locked):is(:hover, :active)" in css
        # Box press deepens the soft shadow only — no transform.
        idx = css.find("&:not(.foliplus-locked):is(:hover, :active)")
        assert idx != -1
        block = css[idx : css.index("}", idx) + 1]
        assert "scale(" not in block, block
        # Shared marquee glow color (resolves to accent-soft-shadow).
        assert "var(--foliplus-marquee-glow-color)" in block
        assert "var(--foliplus-transition-fast)" in css

        assert ".foliplus-export-center" in css
        assert "var(--foliplus-slider-thumb-glow)" in css

        idx = css.find(".foliplus-export-center")
        assert idx != -1, "center anchor rule missing"
        start = css.index("{", idx)
        depth = 0
        end = None
        for i in range(start, len(css)):
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
                if depth == 0:
                    end = i
                    break
        assert end is not None
        # Strip comments first: the rationale prose names "scale()" on purpose.
        block = re.sub(r"/\*.*?\*/", "", css[idx : end + 1], flags=re.S)
        assert "scale(" not in block, block
        assert "transform: translate(-50%, -50%)" in block
        # Round radius so glow/focus-ring project as a circle.
        assert "border-radius: var(--foliplus-radius-round)" in block
        # Center only animates box-shadow — not the pinned translate.
        assert "box-shadow var(--foliplus-transition-fast)" in block
        assert "transform var(" not in block
        assert "transition: var(--foliplus-transition-fast)" not in block

    def test_export_anchors_use_component_focus_ring(self):
        """Export handle/center share one focus-ring rule in ExportControl.css.

        Component-only CSS stays in ExportControl.css (does not sink into
        common). Press stays shadow-only (no scale).
        """
        from conftest import read_css, read_css_dir

        # Shared ring token still lives in token.css.
        tokens = read_css_dir("foliplus/css/common", "token.css")
        assert "--foliplus-focus-ring:" in tokens

        css = read_css("foliplus/css/ExportControl.css")
        # One combined selector for both crop anchors.
        assert ".foliplus-export-handle:focus-visible" in css
        assert ".foliplus-export-center:focus-visible" in css
        assert "var(--foliplus-focus-ring)" in css
        # Export-specific selectors must NOT live in common/button.css.
        button = read_css_dir("foliplus/css/common", "button.css")
        assert ".foliplus-export-handle" not in button
        assert ".foliplus-export-center" not in button
        for selector in (".foliplus-export-handle {", ".foliplus-export-center {"):
            idx = css.find(selector)
            assert idx != -1, selector
            start = css.index("{", idx)
            depth = 0
            end = None
            for i in range(start, len(css)):
                if css[i] == "{":
                    depth += 1
                elif css[i] == "}":
                    depth -= 1
                    if depth == 0:
                        end = i
                        break
            block = re.sub(r"/\*.*?\*/", "", css[idx : end + 1], flags=re.S)
            assert "scale(" not in block, (selector, block)
            assert "border-radius: var(--foliplus-radius-round)" in block, (
                selector,
                block,
            )
