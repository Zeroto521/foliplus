"""Browser tests for row titles and label rename announcements."""

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

    def test_rename_keeps_checkbox_title_and_sets_aria_label(self, browser, tmp_path):
        """Renaming a layer updates the label and aria-label, not the tooltip."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="MyPoints", overlay=True, show=True),
            slug="rename_cb_title",
        ) as (page, _):
            page.wait_for_selector(
                ".foliplus-layer-item",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            assert page.evaluate(_js("LayerControl/rename_first_layer")), (
                "failed to open the inline rename input"
            )
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )
            res = page.evaluate(_js("LayerControl/commit_rename_and_read_checkbox"))
            assert res is not None, "rename did not commit"
            assert res["label"] == "RenamedLayer", f"label={res['label']!r}"
            # The name reaches assistive tech via aria-label…
            assert res["ariaLabel"] == "RenamedLayer", (
                f"aria-label={res['ariaLabel']!r}"
            )
            # …but never replaces the Select/Deselect tooltip (accept the
            # translated wording — a local browser can resolve `zh`).
            assert res["title"] in ("Deselect", "隐藏"), f"title={res['title']!r}"
            # The label's resident full-name tooltip follows the same write:
            # a hover must not keep announcing the old name.
            assert res["labelTitle"] == "RenamedLayer", (
                f"label title={res['labelTitle']!r}"
            )

    def test_color_basemap_rename_updates_label_title(self, browser, tmp_path):
        """A color-basemap rename repaints text and label title together.

        The basemap row has no registry entry — its rename goes through the
        intent store and updateItemLabel — so the resident full-name tooltip
        must follow the text instead of keeping the locale default.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="Layers", overlay=True, show=True),
            slug="rename_color_label_title",
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-id="foliplus_color_map"]',
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)
            res = page.evaluate(_js("LayerControl/rename_color_basemap_and_read_label"))
            assert res is not None, "color basemap rename did not commit"
            assert res["label"] == "My Color", res
            assert res["labelTitle"] == "My Color", f"label title={res['labelTitle']!r}"
            assert not errors, f"JS errors: {errors}"

    def test_updatelayeritemlabel_updates_only_the_id_match_row(
        self, browser, tmp_path
    ):
        """updateLayerItemLabel pushes a rename onto the row named by data-layer-id,
        not the row at the layer's registry index."""
        with use_page(self._make_page, browser, tmp_path, slug="updatelayeritem") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(_js("LayerControl/updatelayeritem_stale_index"))
            assert state is not None, "LayerControl instance not reachable"
            # The precondition: the row at alpha's registry index is a
            # different layer.
            assert state["alphaRegistryIndex"] != state["alphaDomIndex"]
            assert state["labels"]["alpha"] == "A2", (
                "the renamed layer's row was not updated"
            )
            # Whoever sat at alpha's registry index must keep their own name;
            # an index-based lookup would have written the rename there.
            assert state["labels"]["beta"] == "B", (
                "a neighbor's row was rewritten with alpha's name "
                f"({state['staleIndexWouldHaveHit']!r}) — row resolved by index"
            )
            assert state["labels"]["gamma"] == "C"
            assert not errors, f"JS errors: {errors}"
