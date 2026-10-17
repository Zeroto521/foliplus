"""Python-side property and validation tests for foliplus.MeasureControl."""

from __future__ import annotations

import pytest
from conftest import (
    assert_config_value,
    render_control,
)

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
