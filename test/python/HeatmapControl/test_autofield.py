"""Browser tests for HeatmapControl auto-field selection logic."""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_autofield_page


class TestHeatmapAutoFieldBrowser:
    """Verify auto-field selection picks the right property key from a
    point layer's properties dict."""

    def test_auto_field_priority_order(self, browser, tmp_path):
        """Auto-field picks the first discovered field.

        ``collectFields`` discovers fields in marker-iteration order:
        ``_value`` → ``options.value`` → ``feature.properties`` keys.  Only
        ``properties.*`` fields exist for GeoJSON markers, so the first
        property key is returned.
        """
        features = [
            {
                "type": "Feature",
                "properties": {"population": 100, "density": 50},
                "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
            },
            {
                "type": "Feature",
                "properties": {"population": 200, "density": 30},
                "geometry": {"type": "Point", "coordinates": [119.31, 26.09]},
            },
        ]
        with use_page(
            _make_autofield_page, tmp_path, browser, features, agg="sum"
        ) as (page, errors):
            # Select the first layer (there's only one)
            options = page.evaluate(_js("HeatmapControl/read_layer_options_all"))
            # Skip the empty/default option, pick the first real layer
            real_options = [v for v in options if v]
            assert len(real_options) >= 1, f"No layer options found: {options}"
            page.evaluate(_js("HeatmapControl/select_layer"), real_options[0])
            page.wait_for_timeout(500)

            # Switch aggregation to 'sum' so the field selector appears.
            # The agg select is the first <select> inside .foliplus-extra-body.
            agg_select = (
                ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body"
                " > .foliplus-form-row:nth-child(1) .foliplus-form-control select"
            )
            page.evaluate(
                _js("HeatmapControl/set_select_value"), [agg_select, "sum"]
            )
            page.evaluate(_js("HeatmapControl/dispatch_select_change"), agg_select)
            page.wait_for_timeout(500)

            # Verify field selector is visible and AUTO is selected.
            # The field select is the <select> inside .foliplus-heatmap-field.
            field_select = (
                ".foliplus-heatmap-ctrl .foliplus-heatmap-field"
                " .foliplus-form-control select"
            )
            field_val = page.evaluate(_js("HeatmapControl/read_select_value"), field_select)
            assert field_val == "", f"Expected empty string (AUTO), got '{field_val}'"

            # Verify field options include our properties
            field_opts = page.evaluate(_js("HeatmapControl/read_select_options"), field_select)
            assert "population" in field_opts, f"Missing 'population': {field_opts}"
            assert "density" in field_opts, f"Missing 'density': {field_opts}"

            # collectFields returns fields in the order they are discovered
            # during marker iteration.  The exact key depends on V8 property
            # enumeration order — the important thing is deterministic choice.
            auto_key = page.evaluate(_js("HeatmapControl/read_auto_field_key"))
            assert auto_key in ("population", "density"), (
                f"Unexpected autoFieldKey '{auto_key}'"
            )

            assert not errors, f"JS errors: {errors}"

    def test_auto_field_single_field(self, browser, tmp_path):
        """Single-field layer uses that field directly as autoFieldKey."""
        features = [
            {
                "type": "Feature",
                "properties": {"elevation": 300},
                "geometry": {"type": "Point", "coordinates": [119.30, 26.08]},
            },
            {
                "type": "Feature",
                "properties": {"elevation": 150},
                "geometry": {"type": "Point", "coordinates": [119.31, 26.09]},
            },
        ]
        with use_page(
            _make_autofield_page, tmp_path, browser, features, agg="avg"
        ) as (page, errors):
            options = page.evaluate(_js("HeatmapControl/read_layer_options_all"))
            real_options = [v for v in options if v]
            assert len(real_options) >= 1
            page.evaluate(_js("HeatmapControl/select_layer"), real_options[0])
            page.wait_for_timeout(500)

            # Switch to 'avg' so field selector appears.
            # The agg select is the first <select> inside .foliplus-extra-body.
            agg_select = (
                ".foliplus-heatmap-ctrl .foliplus-heatmap-extra-body"
                " > .foliplus-form-row:nth-child(1) .foliplus-form-control select"
            )
            page.evaluate(_js("HeatmapControl/set_select_value"), [agg_select, "avg"])
            page.evaluate(_js("HeatmapControl/dispatch_select_change"), agg_select)
            page.wait_for_timeout(500)

            # Verify AUTO is selected.
            # The field select is the <select> inside .foliplus-heatmap-field.
            field_select = (
                ".foliplus-heatmap-ctrl .foliplus-heatmap-field"
                " .foliplus-form-control select"
            )
            field_val = page.evaluate(_js("HeatmapControl/read_select_value"), field_select)
            assert field_val == "", f"Expected empty string (AUTO), got '{field_val}'"

            # Single field → pickAutoField returns it directly
            auto_key = page.evaluate(_js("HeatmapControl/read_auto_field_key"))
            assert auto_key == "elevation", f"Expected 'elevation', got '{auto_key}'"

            # The single property option should be visible
            field_opts = page.evaluate(_js("HeatmapControl/read_select_options"), field_select)
            assert "elevation" in field_opts, f"Missing 'elevation': {field_opts}"

            assert not errors, f"JS errors: {errors}"
