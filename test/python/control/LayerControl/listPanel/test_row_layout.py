"""Browser tests for row-vs-map color fidelity and the folder row.

The row's author-color getters previously read the LIVE leaf icon after a
write (so a reset re-derived the user's paint) and walked only ONE level while
the capability gates walk the full tree. The fix routes both through the core's
captured-author table and the same walk primitive as the gate, so the row reads
what the map actually draws.

These tests assert the FIXED contract: the style row shows the author's real
paint — the derive path's inline style.color for a glyph, the nested chassis
preset for a group — and keeps a declared standard preset unchanged.

The row is a GeoJson layer, not a FeatureGroup: a FeatureGroup is a container
row now (no style panel), and a bare folium.Marker is a MacroElement rather
than a Layer, so it never becomes a row on its own. A GeoJson layer with a
point feature and a `marker=` template is the leaf that carries an awesome
marker and still owns a style panel.
"""

from __future__ import annotations

import json
import re

import folium
from conftest import _js, load_geojson, make_browser_page, snippet, use_page

from foliplus import LayerControl

from ..helper_browser import LayerControlBrowserBase

_POINT = json.dumps(load_geojson("LayerControl", "point_11934_2611"))


def _marker_layer(name: str, marker: folium.Marker) -> folium.GeoJson:
    """A leaf GeoJson layer whose point renders as *marker*."""
    return folium.GeoJson(_POINT, name=name, marker=marker)


class TestRowColorFidelityBrowser(LayerControlBrowserBase):
    """Row readings agree with the map's real paint."""

    @staticmethod
    def _icon_declared():
        return _marker_layer(
            "Icon declared", folium.Marker(icon=folium.Icon(icon_color="red"))
        )

    @staticmethod
    def _icon_inline_only():
        """Author paints the glyph inline but declares no iconColor option."""
        return _marker_layer(
            "Icon inline",
            folium.Marker(
                icon=folium.DivIcon(html='<i style="color:purple">&#9733;</i>')
            ),
        )

    @staticmethod
    def _marker_color_declared():
        return _marker_layer(
            "MC declared", folium.Marker(icon=folium.Icon(color="green"))
        )

    def _measure(self, browser, tmp_path, layer, slug):
        with use_page(self._make_page, browser, tmp_path, layer, slug=slug) as (
            page,
            errors,
        ):
            self._open_style_ramp(page)
            result = page.evaluate(_js("LayerControl/row_color_fidelity"))
            return result, errors

    def test_icon_color_declared_matches(self, browser, tmp_path):
        """A declared icon color: the row shows it and the map paints it."""
        r, errors = self._measure(
            browser, tmp_path, self._icon_declared(), "fidelity_icon_declared"
        )
        assert r["panel"], r
        assert r["iconColorRow"]["present"], r
        # The row normalizes the author's "red" to the #rrggbb input holds.
        assert r["iconColorRow"]["value"].lower() == "#ff0000", r
        # The map paints the same red.
        assert (
            r["marker"] is not None and r["marker"]["innerColor"] == "rgb(255, 0, 0)"
        ), r
        assert not errors, errors

    def test_icon_color_inline_matches(self, browser, tmp_path):
        """An inline-only author paint: the row reads the map's purple, not white."""
        r, errors = self._measure(
            browser, tmp_path, self._icon_inline_only(), "fidelity_icon_inline"
        )
        assert r["panel"], r
        assert r["iconColorRow"]["present"], r
        # The row must show the author's inline paint (purple), not #ffffff.
        assert r["iconColorRow"]["value"].lower() == "#800080", r
        # The map paints the same purple.
        assert (
            r["marker"] is not None and r["marker"]["innerColor"] == "rgb(128, 0, 128)"
        ), r
        assert not errors, errors

    def test_marker_color_declared_matches(self, browser, tmp_path):
        """A declared chassis preset: the row shows it and the map paints it."""
        r, errors = self._measure(
            browser, tmp_path, self._marker_color_declared(), "fidelity_mc_declared"
        )
        assert r["panel"], r
        assert r["markerColorRow"]["present"], r
        assert r["markerColorRow"]["value"].lower() == "#72b026", {
            "rowValue": r["markerColorRow"]["value"],
            "preset": r["marker"]["preset"] if r["marker"] else None,
        }
        assert r["marker"] is not None and r["marker"]["hasChassis"], r
        assert "awesome-marker-icon-green" in r["marker"]["cls"], r
        assert not errors, errors

    # The nested-group and mixed-group chassis reads used to be asserted here
    # through a FeatureGroup row's style panel. A FeatureGroup is a container
    # row now and a container has no style panel, so the browser-level premise
    # is gone. The capability itself is unchanged and covered where it lives:
    # test/js/control/LayerControl/ui/style/markerColor.test.ts ("reads a nested
    # group like the gate, not one level") and iconColor.test.ts ("shows the
    # author's color for a nested group, like the gate").


class TestFolderRowBrowser(LayerControlBrowserBase):
    """A declared folder renders a folder row; the chevron folds its members."""

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
