"""Browser tests: a row renders the layer it names.

The count column must report the layer's real feature count (a plain point
layer counts as one, and toggling another row's checkbox must not reset the
numbers), and row content is written by `data-layer-id` so a scrambled DOM
cannot stamp one layer's state onto its neighbour's row.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase


class TestRowBrowser(LayerControlBrowserBase):
    def test_plain_marker_layers_count_and_stay_stable(self, browser, tmp_path):
        """A leaf point layer counts as a point feature.

        Regression: countFeatureGeometry / getGeometryType gated on
        ``marker.feature``, so layers built from ``folium.Marker()`` reported a
        count of 0 and showed no type icon.  Counting must not require
        .feature (that only matters for extractPoints / Heatmap properties),
        and toggling an unrelated layer's checkbox must not reset the count.

        The layers here are single-feature GeoJson points (leaf overlays): the
        container semantics treat a folium.FeatureGroup as a container, so a
        plain point row must be a leaf layer.
        """
        layers = []
        for name in ["Alpha", "Beta", "Gamma", "Delta"]:
            # A leaf GeoJson point layer is a leaf (not a container), so the
            # container semantics now treat a FeatureGroup as a container
            # (Style/Filter disabled, 三态 count); a single-feature GeoJson
            # keeps this a plain point-feature overlay row.
            layer = folium.GeoJson(
                json.dumps(load_geojson("LayerControl", "point_11934_2611")),
                overlay=True,
                show=True,
            )
            layer.layer_name = name
            layers.append(layer)

        with use_page(self._make_page, browser, tmp_path, *layers) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            # initTypesAndVisibility (which paints the count columns) runs on a
            # 300ms INIT_DELAY_MS timer after attach, so settle before reading.
            page.wait_for_timeout(500)

            counts = page.evaluate(_js("LayerControl/read_count_columns"))
            assert counts is not None, "read_count_columns failed"
            assert len(counts) == 4, f"expected 4 overlay layers, got {len(counts)}"
            for info in counts.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: plain folium.Marker should count as 1, "
                    f"got {info['apiCount']}"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column should read '1', "
                    f"got {info['countText']!r}"
                )

            # Toggling another layer's checkbox must not zero out the counts.
            page.evaluate(_js("LayerControl/set_test_layer_name_beta"))
            page.evaluate(_js("LayerControl/click_checkbox_by_name"))
            page.wait_for_timeout(300)

            after = page.evaluate(_js("LayerControl/read_count_columns"))
            assert after is not None, "read_count_columns failed after toggle"
            for info in after.values():
                assert info["apiCount"] == 1, (
                    f"{info['name']!r}: count changed to {info['apiCount']} "
                    f"after an unrelated checkbox click"
                )
                assert info["countText"] == "1", (
                    f"{info['name']!r}: count column changed to {info['countText']!r} "
                    f"after an unrelated checkbox click"
                )

    def test_initlayeritem_updates_only_the_id_match_row(self, browser, tmp_path):
        """initLayerItem stamps the row named by data-layer-id, not the one at
        the layer's registry index."""
        with use_page(self._make_page, browser, tmp_path, slug="initlayeritem") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/initlayeritem_scrambled_dom"))
            assert state is not None, "LayerControl instance not reachable"
            # The precondition the assertion depends on: the row sitting at
            # alpha's registry index is a different layer, so only an id lookup
            # can find alpha's row.
            assert state["alphaRegistryIndex"] != state["alphaDomIndex"]
            # initLayerItem wrote alpha's name into alpha's own checkbox.
            assert state["labels"]["alpha"] == "A"
            # ...and left the neighbors' checkboxes alone. An index-based
            # lookup would have stamped "A" onto whoever sat at alpha's
            # registry index.
            assert state["labels"]["beta"] == "B", (
                "a neighbor's row was rewritten with alpha's name "
                f"({state['staleIndexWouldHaveHit']!r}) — row resolved by index"
            )
            assert state["labels"]["gamma"] == "C"
            # Ids the registry does not know about are declined.
            assert state["unknownReturnsFalse"] is False
            assert not errors, f"JS errors: {errors}"
