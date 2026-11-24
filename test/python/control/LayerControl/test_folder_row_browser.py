"""Browser tests for the folder row UI (folder menu + fold)."""

from __future__ import annotations

import re

import folium
from conftest import _js, load_geojson, make_browser_page, snippet, use_page

from foliplus import LayerControl

from .helper_browser import LayerControlBrowserBase


class TestFolderRowBrowser(LayerControlBrowserBase):
    def _page(self, browser, tmp_path):
        fc = load_geojson("LayerControl", "empty_feature_collection")
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        folium.GeoJson(fc, name="Roads", foliplus={"folder": "Roads"}).add_to(m)
        folium.GeoJson(fc, name="Water", foliplus={}).add_to(m)
        LayerControl().add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found in rendered HTML"
        page, errors = make_browser_page(browser, tmp_path, html, "folder_row")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_folder_row_renders_and_folds(self, browser, tmp_path):
        """A declared folder renders a folder row; the chevron folds its members."""
        with use_page(self._page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(400)
            folder_row = page.query_selector(".foliplus-layer-item-folder")
            assert folder_row is not None, "folder row not rendered"
            fk = folder_row.get_attribute("data-folder-key")
            assert fk == "roads", f"expected data-folder-key=roads, got {fk}"
            assert folder_row.get_attribute("data-role") == "overlay"
            member_guide = page.query_selector(
                ".foliplus-layer-item:not(.foliplus-layer-item-folder) .foliplus-layer-rail .foliplus-fold-tree"
            )
            assert member_guide is not None, "member rail lacks fold-tree guide"
            page.click(".foliplus-layer-item-folder .foliplus-layer-fold-btn")
            page.wait_for_timeout(150)
            folded = page.evaluate(_js("LayerControl/count_row_folded"))
            assert folded >= 1, f"expected at least one folded member row, got {folded}"
            assert not errors, f"console errors: {errors}"

    def test_role_row_divider_stops_before_count(self, browser, tmp_path):
        """The role-row divider ends before the count column: the divider is
        collected before count, it does not pass through the icon column. The
        count/icon/more must not be overlapped by any divider.

        Death test: must RED before the CSS fix, GREEN after.
        """
        with use_page(self._page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(400)
            rows = page.evaluate(_js("LayerControl/read_role_row_layout"))
            assert rows, "no role rows rendered"
            for row in rows:
                divider, count, icon, more = (
                    row["divider"],
                    row["count"],
                    row["icon"],
                    row["more"],
                )
                assert divider is not None, "role row lacks divider"
                assert count is not None, "role row lacks count"
                # Divider must end strictly before the count column starts.
                assert divider["right"] <= count["left"], (
                    f"divider overlaps count column: divider right={divider['right']} "
                    f"count left={count['left']}"
                )
                # No leftover section-divider inside the role row.
                assert row["leftoverDividerCount"] == 0, (
                    f"role row has {row['leftoverDividerCount']} leftover section-divider"
                )
                # count/icon/more must be distinct columns (no mutual overlap).
                assert icon is not None, "role row lacks icon column"
                assert more is not None, "role row lacks more button"
                assert count["right"] <= icon["left"], (
                    f"count overlaps icon: count right={count['right']} icon left={icon['left']}"
                )
                assert icon["right"] <= more["left"], (
                    f"icon overlaps more: icon right={icon['right']} more left={more['left']}"
                )
            assert not errors, f"console errors: {errors}"

    def _page_two_folders(self, browser, tmp_path):
        """A page with two folder blocks in the overlay role, each with a member."""
        fc = load_geojson("LayerControl", "empty_feature_collection")
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        folium.GeoJson(fc, name="Roads", foliplus={"folder": "Roads"}).add_to(m)
        folium.GeoJson(fc, name="Water", foliplus={"folder": "Water"}).add_to(m)
        LayerControl().add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1
        page, errors = make_browser_page(browser, tmp_path, html, "two_folders")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_folder_drag_reorders_blocks(self, browser, tmp_path):
        """A folder row can be dragged to reorder the folder blocks.

        Reproduces the user report: folder rows could not be dragged to sort.
        The HTML5 drag is simulated via CDP Input.dispatchDragEvent since
        Playwright mouse events do not trigger HTML5 drag-and-drop.
        """
        with use_page(self._page_two_folders, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_timeout(400)

            def get_folder_names():
                return page.evaluate(snippet("LayerControl/folder_names"))

            before = get_folder_names()
            assert len(before) >= 2, f"expected 2+ folder rows, got {before}"

            # Drag the first folder row to after the second
            src_row = page.query_selector(".foliplus-layer-item-folder")
            src_box = src_row.bounding_box()
            tgt_row = page.query_selector_all(".foliplus-layer-item-folder")[1]
            tgt_box = tgt_row.bounding_box()

            src_x = src_box["x"] + src_box["width"] / 2
            src_y = src_box["y"] + src_box["height"] / 2
            # Drop at the bottom quarter of the target folder row: the "after"
            # zone places the dragged folder AFTER the target (block reorder).
            # The center is the "into" zone, which correctly refuses folder
            # nesting — so we must drop at the edge to test sorting.
            page.locator(".foliplus-layer-item-folder").nth(0).drag_to(
                page.locator(".foliplus-layer-item-folder").nth(1),
                target_position={
                    "x": tgt_box["width"] / 2,
                    "y": tgt_box["height"] * 0.85,
                },
            )
            page.wait_for_timeout(400)

            after = get_folder_names()
            print(f"  before={before} after={after}")
            # The dragged folder (roads) moves after water: the order flips.
            assert after == ["water", "roads"], (
                f"folder order did not change after drag: before={before} after={after}"
            )
