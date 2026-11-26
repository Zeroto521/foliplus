"""Browser tests: the row's style columns show the map's real paint.

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


class TestRowStyleBrowser(LayerControlBrowserBase):
    """Row style readings agree with the map's real paint."""

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

            # Drag the first folder block to after the second one. The drag is
            # driven from a snippet rather than Playwright's drag_to: the
            # dragged block folds its members, so the target row moves UP
            # between dragstart and drop and a coordinate captured before the
            # drag would miss it. The snippet measures the target after the
            # compact and drops at its bottom edge — the "after" zone, which is
            # a block reorder (the centre is the "into" zone, a refusal).
            moved = page.evaluate(_js("LayerControl/folder_drag_reorder"))
            page.wait_for_timeout(400)
            assert moved["before"] == before, (moved, before)

            after = get_folder_names()
            print(f"  before={before} after={after}")
            # The dragged folder (roads) moves after water: the order flips.
            assert after == ["water", "roads"], (
                f"folder order did not change after drag: before={before} after={after}"
            )


_ROLE = '.foliplus-layer-role[data-role="overlay"]'
_LAYER = (
    '.foliplus-layer-item[data-layer-type="overlay"]:not(.foliplus-layer-item-folder)'
)
_FOLDER = ".foliplus-layer-item-folder"


class TestRowInteractionParityBrowser(LayerControlBrowserBase):
    """The role header paints its interaction states exactly like a layer row.

    The role header is deliberately not a .foliplus-layer-item (that class means
    "a layer row" to the panel's own selectors and to the browser tests), so it
    joins the Row-cursor recipe by its own selector. Its fold chevron used to
    carry a private rule that turned accent on hover/focus and text-primary when
    folded — the inverse of a folder row's chevron, and the transient accent is
    the "变红" the user reported. The contract: rest / hover / keyboard focus /
    checked paint matches a layer row, and the chevron matches a folder row
    (accent only while folded, never on a transient hover or focus).
    """

    def _page(self, browser, tmp_path):
        fc = load_geojson("LayerControl", "empty_feature_collection")
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        folium.GeoJson(fc, name="Roads", foliplus={"folder": "Roads"}).add_to(m)
        folium.GeoJson(fc, name="Water", foliplus={}).add_to(m)
        LayerControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "row_interaction")
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    @staticmethod
    def _read(page, selector):
        """Settled interaction paint of one row (the chevron colour transitions)."""
        page.wait_for_timeout(350)
        return page.evaluate(_js("LayerControl/read_row_interaction_style"), selector)

    def test_role_row_interaction_paint_matches_layer_and_folder_rows(
        self, browser, tmp_path
    ):
        with use_page(self._page, browser, tmp_path) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(_ROLE, state="attached", timeout=5000)
            page.wait_for_timeout(400)

            text_primary = self._sample_token(page, "--foliplus-text-primary")
            accent = self._sample_token(page, "--foliplus-accent-primary")

            # The role header must not carry the layer-row class: a header
            # matching it made every leaf-row lookup resolve to the header.
            assert (
                page.evaluate(
                    _js("LayerControl/row_has_class"), [_ROLE, "foliplus-layer-item"]
                )
                is False
            )

            # ── Rest: same explicit surface, no glow, same persistent left bar ──
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            rest_role = self._read(page, _ROLE)
            rest_layer = self._read(page, _LAYER)
            rest_folder = self._read(page, _FOLDER)
            assert rest_role["background"] == rest_layer["background"]
            assert rest_role["glow"] == rest_layer["glow"] == "none"
            assert rest_role["leftBar"] == rest_layer["leftBar"]
            assert rest_role["outline"] == rest_layer["outline"] == "none"
            # Both rows are checked (their layers are on), so both carry the
            # persistent wash and accent bar.
            assert rest_role["active"] and rest_layer["active"]
            # The ⋮ button is the row's accent affordance: an active row wakes
            # it to accent on all three row kinds. A role header whose ⋮ stays
            # text-primary here is the bug the user reported (its menu.css rule
            # selected on .foliplus-layer-item alone and missed the header).
            assert (
                rest_role["moreColor"]
                == rest_layer["moreColor"]
                == rest_folder["moreColor"]
                == accent
            ), "rest: the ⋮ must wake to accent on every row kind"

            # ── Hover: white surface + top/bottom glow, chevron stays neutral ──
            page.hover(_ROLE)
            hover_role = self._read(page, _ROLE)
            page.hover(_LAYER)
            hover_layer = self._read(page, _LAYER)
            page.hover(_FOLDER)
            hover_folder = self._read(page, _FOLDER)
            assert hover_role["background"] == hover_layer["background"]
            assert hover_role["glow"] == hover_layer["glow"] != "none"
            assert hover_role["leftBar"] == hover_layer["leftBar"]
            assert (
                hover_role["foldColor"] == hover_folder["foldColor"] == text_primary
            ), "hover must not tint the role chevron: a transient accent is the bug"
            # The ⋮ stays accent on hover for all three row kinds (menu.css
            # wakes it on :hover via .foliplus-row now, so the role header is
            # included). A black role ⋮ beside an accent layer ⋮ is the bug.
            assert (
                hover_role["moreColor"]
                == hover_layer["moreColor"]
                == hover_folder["moreColor"]
                == accent
            ), "hover: the ⋮ must be accent on every row kind"

            # ── Keyboard focus: same recipe, chevron still neutral ──
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            assert page.evaluate(_js("LayerControl/focus_row_keyboard"), _ROLE) is True
            focus_role = self._read(page, _ROLE)
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            assert page.evaluate(_js("LayerControl/focus_row_keyboard"), _LAYER) is True
            focus_layer = self._read(page, _LAYER)
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            assert (
                page.evaluate(_js("LayerControl/focus_row_keyboard"), _FOLDER) is True
            )
            focus_folder = self._read(page, _FOLDER)
            assert focus_role["focused"] and focus_layer["focused"]
            assert focus_role["background"] == focus_layer["background"]
            assert focus_role["glow"] == focus_layer["glow"]
            assert focus_role["leftBar"] == focus_layer["leftBar"]
            assert focus_role["outline"] == focus_layer["outline"] == "none"
            assert focus_role["foldColor"] == focus_folder["foldColor"] == text_primary
            # The ⋮ wakes to accent under the keyboard cursor on every row kind.
            assert (
                focus_role["moreColor"]
                == focus_layer["moreColor"]
                == focus_folder["moreColor"]
                == accent
            ), "focus: the ⋮ must be accent on every row kind"

            # ── Folded: accent chevron + accent left bar, like a folder row ──
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            assert page.evaluate(_js("LayerControl/click_row_fold"), _FOLDER) is True
            folded_folder = self._read(page, _FOLDER)
            page.evaluate(_js("LayerControl/clear_row_cursor"))
            assert page.evaluate(_js("LayerControl/click_row_fold"), _ROLE) is True
            folded_role = self._read(page, _ROLE)
            assert folded_role["folded"] and folded_folder["folded"]
            assert folded_role["foldColor"] == folded_folder["foldColor"] == accent
            assert folded_role["leftBar"] == accent

            # Hovering a folded row keeps the persistent accent — no inversion.
            page.hover(_ROLE)
            folded_hover_role = self._read(page, _ROLE)
            assert folded_hover_role["foldColor"] == accent

            assert not errors, f"console errors: {errors}"
