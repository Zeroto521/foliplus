"""Python-side property and validation tests for foliplus.ExportControl."""

from __future__ import annotations

import json

import pytest

from foliplus import ExportControl


class TestExportControlConstructor:
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
