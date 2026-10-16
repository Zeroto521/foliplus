"""Pane birth-z browser tests for foliplus.LayerControl."""

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


class TestPaneZBrowser:
    """A pane is born already carrying its slot's z — never Leaflet's 400.

    Leaflet gives a fresh pane ``z-index: 400`` from its base CSS, above every
    basemap. A pane created before its layer joins the registry had no slot to
    price, so it painted at 400 until the next ordering pass. The gate: the
    pane does not exist until ``register()``, and by the time ``register()``
    returns it already carries the z the ordering pass would give it.
    """

    @staticmethod
    def _probe(browser, tmp_path, slug="birth"):
        """Render a map with LayerControl (a real registry to price slots)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_canvas_pane_is_born_at_its_slot_z(self, browser, tmp_path):
        """register() returns with the pane already at its final z."""
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(_js("LayerControl/pane_birth_z"))
        assert r is not None, "LayerAPI missing"
        assert r["ok"] is True, r
        # The pane is not allocated by createCanvas — only the face is built,
        # detached — so there is no window in which it can paint at 400.
        assert r["paneBeforeRegister"] is None, f"pane allocated before register: {r}"
        assert r["zAtRegister"] != 400, f"pane still at Leaflet's default z: {r}"
        assert r["inlineAtRegister"] not in (None, ""), (
            f"no inline z stamped at register: {r}"
        )
        # Birth z == final z: the ordering pass rewrites nothing.
        assert r["zAtRegister"] == r["zAfterOrder"], (
            f"ordering pass moved the pane: {r}"
        )
        assert not errors, f"JS errors: {errors}"
