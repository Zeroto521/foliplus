"""Browser tests for foliplus.LayerControl — label & label canvas."""

from __future__ import annotations

import json
import re

import folium
from conftest import (
    _js,
    leaflet_path,
    leaflet_points,
    load_geojson,
    panel_ready,
    use_page,
)

from foliplus import LayerControl

from ..helper_browser import LayerControlBrowserBase

class TestLabelBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — label & label canvas."""
    def test_label_canvas_draws(self, browser, tmp_path):
        """Enabling labels draws text onto the shared label canvas."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/label_canvas_draws"),
                {"points": load_geojson("common", "points_fuzhou_alpha_beta")},
            )
            assert result is not None, "label manager or LayerAPI not found"
            assert result["canvas"] is True, f"canvas not created: {result}"
            assert result["opaque"] > 0, "canvas has no drawn pixels"
            assert not errors, f"JS errors: {errors}"

    def test_label_overlap_hides(self, browser, tmp_path):
        """Two labels whose halo-inclusive boxes overlap collapse to the first."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/label_overlap_hides"))
            assert result is not None, "label manager or LayerAPI not found"
            assert result["canvas"] is True, f"canvas not created: {result}"
            assert result["aOpaque"] > 0, "first (kept) label was not drawn"
            assert result["bOpaque"] == 0, "second (hidden) label was drawn"
            assert not errors, f"JS errors: {errors}"

    @staticmethod
    def _declared_label_layer(name, label, coords, text="12345678901234567890"):
        """A point layer whose foliplus namespace declares its label defaults."""
        features = [
            {
                "type": "Feature",
                "properties": {"name": text},
                "geometry": {"type": "Point", "coordinates": [lng, lat]},
            }
            for lat, lng in coords
        ]
        return folium.GeoJson(
            json.dumps({"type": "FeatureCollection", "features": features}),
            name=name,
            foliplus={"label": label},
        )

    def test_label_declared_color_and_size_reach_the_canvas(self, browser, tmp_path):
        """A declared color/size paints the real canvas, and Reset restores it.

        Reads the label canvas pixels: the declared #00ff00 and size 24
        must be what is actually drawn (not merely what CONF/DOM says), a
        panel-equivalent override must repaint blue, Reset must show the
        declaration again, and a persisted override must survive a reload.
        """
        layer = self._declared_label_layer(
            "Declared Style",
            {"field": "name", "color": "#00ff00", "size": 24},
            [(26.08, 119.30)],
        )
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not open"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            result = page.evaluate(_js("LayerControl/label_declared_style"))
            assert result and not result.get("error"), result

            declared = result["declared"]
            cfg = declared["cfg"]
            assert cfg["color"] == "#00ff00", cfg
            assert cfg["size"] == 24, cfg
            assert cfg["show"] is True, cfg
            assert declared["pixels"]["green"] > 100, declared["pixels"]
            bbox = declared["pixels"]["bbox"]
            assert bbox and 12 <= bbox["h"] <= 60, bbox

            overridden = result["overridden"]
            assert overridden["cfg"]["color"] == "#0000ff", overridden["cfg"]
            assert overridden["pixels"]["blue"] > 100, overridden["pixels"]
            assert overridden["pixels"]["green"] == 0, overridden["pixels"]
            stored = [
                key
                for key, raw in result["storage"].items()
                if raw and "#0000ff" in raw
            ]
            assert stored, (
                f"the override did not reach localStorage: {result['storage']}"
            )

            reset = result["afterReset"]
            assert reset["cfg"]["color"] == "#00ff00", reset["cfg"]
            assert reset["cfg"]["size"] == 24, reset["cfg"]
            assert reset["pixels"]["green"] > 100, reset["pixels"]
            assert reset["pixels"]["blue"] == 0, reset["pixels"]

            smaller = result["smaller"]
            assert smaller["cfg"]["size"] == 10, smaller["cfg"]
            assert smaller["pixels"]["green"] < declared["pixels"]["green"] / 1.5, (
                f"size 10 did not shrink the painted label: {smaller['pixels']} vs {declared['pixels']}"
            )

            # Reload: the persisted user override beats the declaration.
            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not reopen"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            after = page.evaluate(_js("LayerControl/label_declared_read"))
            assert after and not after.get("error"), after
            assert after["cfg"]["color"] == "#0000ff", after
            assert after["cfg"]["size"] == 24, after
            assert after["blue"] > 0, after
            assert not errors, f"JS errors: {errors}"

    def test_label_declared_collide_false_keeps_overlapping_labels(
        self, browser, tmp_path
    ):
        """A declared collide=false keeps both labels; the default hides one."""
        coords = [(26.08, 119.30), (26.08, 119.3076)]
        layer = self._declared_label_layer(
            "Declared Collide",
            {"field": "name", "collide": False},
            coords,
        )
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not open"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            result = page.evaluate(
                _js("LayerControl/label_declared_collide"),
                [list(c) for c in coords],
            )
            assert result and not result.get("error"), result
            declared = result["declared"]
            assert declared["cfg"]["collide"] is False, declared["cfg"]
            assert declared["labels"] == 2, declared
            assert declared["opaque"] > 0, declared
            collided = result["collided"]
            assert collided["cfg"]["collide"] is True
            # collide=true drops the overlapping label: the same canvas holds
            # visibly fewer pixels (measured 1362 -> 1049, ~1.3x).
            assert declared["opaque"] > collided["opaque"] * 1.15, (
                f"declared collide=false did not keep the second label: {declared} vs {collided}"
            )

            # The style panel's own "Avoid overlap" switch reads the merged
            # config: unchecked while collide is declared false, flipping it
            # writes the user's true, repaints, and persists across a reload.
            toggled = page.evaluate(_js("LayerControl/label_collide_toggle"), True)
            assert toggled and not toggled.get("error"), toggled
            assert toggled["declared"]["checked"] is False, toggled["declared"]
            assert toggled["declared"]["cfg"]["collide"] is False, toggled["declared"]
            assert toggled["flipped"]["checked"] is True, toggled["flipped"]
            assert toggled["flipped"]["cfg"]["collide"] is True, toggled["flipped"]
            assert (
                toggled["declared"]["opaque"] > toggled["flipped"]["opaque"] * 1.15
            ), toggled
            assert toggled["stored"] and "collide" in toggled["stored"], (
                f"the toggle change did not persist: {toggled['stored']}"
            )

            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            assert page.evaluate(_js("LayerControl/open_panel")), "panel did not reopen"
            page.wait_for_selector(
                ".foliplus-layer-item", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            after = page.evaluate(_js("LayerControl/label_collide_toggle"), False)
            assert after and not after.get("error"), after
            assert after["declared"]["checked"] is True, after["declared"]
            assert after["declared"]["cfg"]["collide"] is True, after["declared"]

            assert not errors, f"JS errors: {errors}"
