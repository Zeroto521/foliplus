"""Python-side property and validation tests for foliplus.HeatmapControl."""

from __future__ import annotations

import pytest
from conftest import (
    assert_config_value,
    render_control,
)

from foliplus import HeatmapControl


class TestHeatmapControlConstructor:
    """Python-side property tests."""

    def test_name(self):
        assert HeatmapControl()._name == "HeatmapControl"

    def test_default_position(self):
        assert HeatmapControl().position == "topleft"

    def test_custom_position(self):
        assert HeatmapControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert HeatmapControl()._locale_code == ""

    def test_custom_locale(self):
        assert HeatmapControl(locale="zh")._locale_code == "zh"

    def test_default_params(self):
        """Default params produce correct CONFIG JSON."""
        html = render_control(HeatmapControl())
        assert_config_value(html, "color_scheme", "Reds")
        assert_config_value(html, "method", "jenks")
        assert_config_value(html, "num_classes", 6)
        assert_config_value(html, "agg", "count")
        assert_config_value(html, "border_weight", 1.5)
        assert_config_value(html, "label_show", True)
        assert_config_value(html, "label_color", "#fff")
        assert_config_value(html, "label_size", 11)
        assert_config_value(html, "label_format", "auto")

    def test_declared_layer_and_field_serialize(self):
        """layer/field declarations reach CONFIG for the JS startup path."""
        html = render_control(HeatmapControl(layer="Facility Points", field="score"))
        assert_config_value(html, "layer", "Facility Points")
        assert_config_value(html, "field", "score")

    def test_declared_layer_and_field_default_to_null(self):
        """Undecided declarations serialize as null, never as a fake name."""
        html = render_control(HeatmapControl())
        assert_config_value(html, "layer", None)
        assert_config_value(html, "field", None)

    def test_custom_params(self):
        """Custom params produce correct CONFIG JSON."""
        html = render_control(
            HeatmapControl(
                color_scheme="Reds",
                method="quantile",
                num_classes=4,
                agg="sum",
                schemes=["Reds", "Blues"],
                border_weight=2.0,
                label_show=False,
                label_format="percent",
            )
        )
        assert_config_value(html, "color_scheme", "Reds")
        assert_config_value(html, "method", "quantile")
        assert_config_value(html, "num_classes", 4)
        assert_config_value(html, "agg", "sum")
        assert_config_value(html, "border_weight", 2.0)
        assert_config_value(html, "label_show", False)
        assert_config_value(html, "label_format", "percent")

    def test_invalid_label_format_raises(self):
        with pytest.raises(ValueError, match="label_format must be one of"):
            HeatmapControl(label_format="invalid")

    def test_invalid_method_raises(self):
        """Invalid method raises ValueError."""
        with pytest.raises(ValueError, match="method must be one of"):
            HeatmapControl(method="invalid")

    def test_invalid_agg_raises(self):
        """Invalid agg raises ValueError."""
        with pytest.raises(ValueError, match="agg must be one of"):
            HeatmapControl(agg="invalid")

    def test_invalid_num_classes_raises_too_low(self):
        """num_classes below 2 raises ValueError."""
        with pytest.raises(
            ValueError, match="num_classes must be an int between 2 and 9"
        ):
            HeatmapControl(num_classes=1)

    def test_invalid_num_classes_raises_too_high(self):
        """num_classes above 9 raises ValueError."""
        with pytest.raises(
            ValueError, match="num_classes must be an int between 2 and 9"
        ):
            HeatmapControl(num_classes=10)

    def test_invalid_num_classes_raises_not_int(self):
        """Non-int num_classes raises ValueError."""
        with pytest.raises(
            ValueError, match="num_classes must be an int between 2 and 9"
        ):
            HeatmapControl(num_classes=6.5)

    def test_invalid_fill_opacity_raises(self):
        """Opacity outside 0.0-1.0 raises ValueError."""
        with pytest.raises(
            ValueError, match="fill_opacity must be a number between 0.0 and 1.0"
        ):
            HeatmapControl(fill_opacity=1.5)

    def test_invalid_border_opacity_raises(self):
        with pytest.raises(
            ValueError, match="border_opacity must be a number between 0.0 and 1.0"
        ):
            HeatmapControl(border_opacity=-0.1)

    def test_negative_border_weight_raises(self):
        with pytest.raises(ValueError, match="border_weight must be a number >= 0.0"):
            HeatmapControl(border_weight=-1.0)

    def test_zero_label_size_raises(self):
        with pytest.raises(ValueError, match="label_size must be a positive int"):
            HeatmapControl(label_size=0)
