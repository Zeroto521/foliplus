"""Python-side tests for foliplus.LayerControl (name/position/config/locale)."""

from __future__ import annotations

import base64
import json
import re
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_config_value,
    assert_locale,
    heatmap_ready,
    make_browser_page,
    panel_ready,
    read_css,
    read_css_dir,
    render,
    render_control,
    use_page,
    use_raw_page,
)
from folium import Element

from foliplus import HeatmapControl, LayerControl


class TestLayerControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert LayerControl()._name == "LayerControl"

    def test_default_position(self):
        assert LayerControl().position == "topleft"

    def test_custom_position(self):
        assert LayerControl(position="bottomright").position == "bottomright"

    def test_default_locale(self):
        assert LayerControl()._locale_code == ""

    def test_default_label_collide(self):
        assert LayerControl().label_collide is True

    def test_custom_label_collide(self):
        assert LayerControl(label_collide=False).label_collide is False

    def test_label_collide_in_config_fields(self):
        assert "label_collide" in LayerControl._config_fields

    def test_custom_locale(self):
        assert LayerControl(locale="zh")._locale_code == "zh"

    def test_render_collects_layers(self):
        """LayerControl has render() and builds data from the parent map."""
        ctrl = LayerControl()
        assert hasattr(ctrl, "render")

    def test_render_overlays_and_base(self):
        """render() correctly flags base vs overlay layers in data."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer("OpenStreetMap", name="OSM", overlay=False).add_to(m)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(m)
        m.render()

        flags = {d["name"]: d["group"] for d in ctrl._config["data"]}
        assert flags["OSM"] == "base", f"OSM should be base: {flags}"
        assert flags["Points"] == "overlay", f"Points should be overlay: {flags}"

    def test_render_collects_layers_attached_to_control(self):
        """Layers added to the control itself are collected, not just the map.

        folium's add_child stores elements in an OrderedDict on the *parent*
        object, and Map.get_root() returns the enclosing Figure — a different
        object. So Map._children only holds controls after render(); layers live
        on the Figure's script element. A layer added to the control is reached
        only by reading the control's own _children, which is the union path in
        _extra_config. Without it the control renders an empty panel.
        """
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            name="Carto",
            overlay=False,
            attr="&copy; OpenStreetMap contributors",
        ).add_to(ctrl)
        folium.FeatureGroup(name="Points", overlay=True, show=True).add_to(ctrl)
        m.render()

        flags = {d["name"]: d["group"] for d in ctrl._config["data"]}
        assert flags["Carto"] == "base", f"Carto should be base: {flags}"
        assert flags["Points"] == "overlay", f"Points should be overlay: {flags}"

    def test_render_dedupes_layer_reached_from_both(self):
        """A layer on both the map and the control appears once, keyed by name."""
        m = folium.Map()
        ctrl = LayerControl().add_to(m)
        layer = folium.TileLayer(
            "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
            name="Carto",
            overlay=False,
            attr="&copy; OpenStreetMap contributors",
        )
        layer.add_to(m)
        layer.add_to(ctrl)
        m.render()

        names = [d["name"] for d in ctrl._config["data"]]
        assert names.count("Carto") == 1, f"Carto duplicated: {names}"
        # folium.Map() auto-adds its own 'openstreetmap' basemap, so the map
        # child set is Carto + openstreetmap. What matters is that reaching
        # Carto from two places did not double it.
        assert set(names) == {"Carto", "openstreetmap"}, f"unexpected layers: {names}"
