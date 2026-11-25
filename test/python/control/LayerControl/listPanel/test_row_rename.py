"""Browser tests: inline row renaming.

Opening the inline rename input drops the row's vertical padding so the input
fills the whole row instead of collapsing to a single 19.6px text line — the
regression was the scoped row padding rule outranking a bare renaming rule.
"""

from __future__ import annotations

import folium
from conftest import _js, use_page

from ..helper_browser import LayerControlBrowserBase


class TestRowRenameBrowser(LayerControlBrowserBase):
    def test_rename_input_fills_row_height(self, browser, tmp_path):
        """The inline rename input spans the full row height (not a 19.6px line).

        Regression guard for the scoped `.foliplus-layer-ctrl .foliplus-layer-item`
        padding rule outranking a bare `.foliplus-layer-renaming` rule — if that
        priority regresses, the row keeps its 8px vertical padding and the input
        collapses back to a single line.
        """
        layer = folium.FeatureGroup(name="My Layer")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="rename_visual"
        ) as (
            page,
            _,
        ):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item",
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/rename_first_layer"))
            assert ok, "failed to open the inline rename input"
            page.wait_for_selector(
                ".foliplus-layer-rename-input", state="attached", timeout=5000
            )

            m = page.evaluate(_js("LayerControl/read_rename_input_geom"))
            assert m is not None, "no renaming row found"
            # Row's vertical padding is dropped while renaming…
            assert m["padTop"] == "0px", f"row padTop={m['padTop']}"
            assert m["padBottom"] == "0px", f"row padBottom={m['padBottom']}"
            # …so the input fills the whole row, not a 19.6px line-box.
            assert abs(m["inputH"] - m["rowH"]) <= 1, (
                f"input height {m['inputH']} != row height {m['rowH']}"
            )
