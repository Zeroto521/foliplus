"""Split of test_panel.py by dimension."""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)
from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from ..helper import _expand_panel, _geo_mixed, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestPanelBrowser(LayerControlBrowserBase):
    def test_row_panel_close_x_keeps_native_activation_keys(self, browser, tmp_path):
        """Space/Enter on a row panel's close × activate it, not the row checkbox.

        Regression: the close × is a real <button>, but the input-ownership
        table did not classify buttons as consuming Enter/Space. The
        document-level row-toggle shortcut therefore cancelled the key and
        flipped the layer checkbox behind the panel. Real keyboard presses go
        through Chromium — synthetic dispatchEvent cannot prove that the
        browser's own activation ran — and both row panels that exist today
        (attributes and style) are covered for both activation keys. The
        capture log reports whether foliplus cancelled the key; the checkbox
        state proves the row shortcut did not run.
        """
        geo = folium.GeoJson(_geo_mixed, name="Point layer")
        with use_page(
            self._make_page, browser, tmp_path, geo, slug="row_panel_close_x"
        ) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )

            for kind in ("attrs", "style"):
                for key in ("Space", "Enter"):
                    arm = page.evaluate(_js("LayerControl/row_panel_close_arm"), kind)
                    assert arm.get("error") is None, f"{kind}: setup failed: {arm}"
                    assert arm["focusedTag"] == "button", (
                        f"{kind}: the close × did not take focus: {arm}"
                    )
                    assert "foliplus-close-btn" in arm["focusedClass"], (
                        f"{kind}: focus is not on the close ×: {arm}"
                    )

                    page.keyboard.press(key)

                    read = page.evaluate(_js("LayerControl/row_panel_close_read"))
                    presses = [
                        r for r in (read["records"] or []) if r["tag"] == "button"
                    ]
                    assert len(presses) == 1, (
                        f"{kind}/{key}: expected one button keydown, "
                        f"got {read['records']}"
                    )
                    assert presses[0]["prevented"] is False, (
                        f"{kind}/{key}: foliplus cancelled the button's native "
                        f"activation key: {read['records']}"
                    )
                    assert not read["attrsOpen"] and not read["styleOpen"], (
                        f"{kind}/{key}: the close × did not close its panel: {read}"
                    )
                    assert read["checkboxAfter"] == arm["checkboxBefore"], (
                        f"{kind}/{key}: the row shortcut flipped the layer "
                        f"checkbox: before={arm['checkboxBefore']} "
                        f"after={read['checkboxAfter']}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_native_gate_checkbox_space(self, browser, tmp_path):
        """Space on a focused row checkbox flips it exactly once, via the native path.

        Row 2 of the table. foliplus owns no key of a checkbox, so its own
        row-toggle shortcut must not run alongside the native flip — otherwise
        the layer would be applied twice. A real keypress again, with the
        final ``defaultPrevented`` read from a capture listener.
        """
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        with use_page(self._make_page, browser, tmp_path, overlay) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            arm = page.evaluate(
                _js("LayerControl/native_gate_arm"),
                load_geojson("common", "point_1193_2608"),
            )
            assert arm.get("error") is None, f"setup failed: {arm}"
            mid = page.evaluate(_js("LayerControl/native_gate_mid"))
            assert mid["cbType"] == "checkbox", f"not a checkbox: {mid}"
            assert mid["focusedType"] == "checkbox", f"checkbox not focused: {mid}"

            page.keyboard.press(" ")

            read = page.evaluate(_js("LayerControl/native_gate_read"))
            recs = [r for r in (read["records"] or []) if r["type"] == "checkbox"]
            assert recs, "no keydown reached document while the checkbox was focused"
            assert len(recs) == 1, (
                f"Space observed {len(recs)} times: {read['records']}"
            )
            assert recs[0]["prevented"] is False, (
                "foliplus cancelled the Space the checkbox was flipping on: "
                + str(read["records"])
            )
            assert read["cbAfter"] is not None, str(read)
            assert read["cbAfter"] != mid["cbBefore"], (
                "the checkbox did not flip: before="
                + str(mid["cbBefore"])
                + " after="
                + str(read["cbAfter"])
            )
            # Baseline is the cursor left by the checkbox focus itself, which is
            # the cursor by design: only a change caused by the keypress counts.
            assert read["rowFocused"] == mid["rowFocusedAfterFocus"], (
                "the row keyboard cursor moved on the Space that the checkbox "
                "was flipping on: after-focus="
                + str(mid["rowFocusedAfterFocus"])
                + " after-press="
                + str(read["rowFocused"])
            )
            assert not errors, f"JS errors: {errors}"

    def test_input_skin_computed_parity(self, browser, tmp_path):
        """The LayerControl style-panel inputs resolve one computed skin
        from .foliplus-input-skin.

        The method select and label-size number must both resolve the same
        height, frame, radius, ink, type size and box model (the Heatmap layer
        select has its own test in test_panel.py). jsdom never loads the
        stylesheet cascade, so only a browser can prove the parity: a missing
        foliplus-input-skin on a call site reads UA defaults (e.g.
        height: auto) and fails here.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._declared_ramp_layer(),
            slug="input_skin",
        ) as (page, errors):
            self._open_style_ramp(page)
            # The layer declares a value fill, so the panel opens on the
            # by-value mode and the method select is present; the probe reveals
            # the label body under its toggle before reading the label-size
            # number.
            data = page.evaluate(_js("LayerControl/read_input_skin"))
            assert data["lc"]["ok"], f"method/number not found: {data}"
            t = data["tokens"]
            assert t["ctrlSize"], f"ctrl-size token unresolved: {data}"
            assert t["borderThin"], f"border-thin token unresolved: {data}"
            assert t["radiusSm"], f"radius-sm token unresolved: {data}"
            assert t["fontSizeMd"], f"font-size-md token unresolved: {data}"
            assert t["inputBg"], f"input-bg token unresolved: {data}"
            assert t["textPrimary"], f"text-primary token unresolved: {data}"
            for name, got in (
                ("method", data["lc"]["method"]),
                ("number", data["lc"]["number"]),
            ):
                assert got["height"] == t["ctrlSize"], (name, data)
                assert got["borderTopWidth"] == t["borderThin"], (name, data)
                assert got["borderRadius"] == t["radiusSm"], (name, data)
                assert got["backgroundColor"] == t["inputBg"], (name, data)
                assert got["fontSize"] == t["fontSizeMd"], (name, data)
                assert got["color"] == t["textPrimary"], (name, data)
                assert got["boxSizing"] == "border-box", (name, data)
            assert not errors, f"JS errors: {errors}"

    def test_row_panels_pin_only_on_request(self, browser, tmp_path):
        """Pinning is opt-in: this PR's panels pin, a plain row panel does not.

        The shared `.foliplus-row-panel` shell defaults to the plain
        row-anchored absolute card. Only a caller that knows the card would be
        clipped by the layer list's scroll box opts into `pinRowPanel`, which
        adds the pinned marker and places the fixed card from the row's rect.
        A caller that skips the helper (an unmerged filter panel builds one) must
        therefore keep its plain behaviour instead of landing at the viewport
        corner — the regression this test pins.
        """
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_focus_box")),
            overlay=True,
            show=True,
        )
        layer.layer_name = "Row panel pin"
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="row_panel_pin"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(300)

            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            style = page.evaluate(_js("LayerControl/row_panel_pin_state"))
            assert not errors, f"JS errors: {errors}"
            assert style["style"]["pinned"] is True, style
            assert style["style"]["position"] == "fixed", style
            assert style["style"]["inViewport"] is True, (
                f"the pinned style panel left the viewport: {style['style']}"
            )

            page.mouse.click(900, 450)
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="detached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_first_overlay_more_btn"))
            page.wait_for_selector(
                ".foliplus-layer-more-menu.open", state="attached", timeout=5000
            )
            page.evaluate(_js("LayerControl/click_layer_attributes"))
            page.wait_for_selector(
                ".foliplus-layer-attrs-panel", state="visible", timeout=5000
            )
            attrs = page.evaluate(_js("LayerControl/row_panel_pin_state"))
            assert attrs["attrs"]["pinned"] is True, attrs
            assert attrs["attrs"]["position"] == "fixed", attrs
            assert attrs["attrs"]["inViewport"] is True, attrs
            assert attrs["fixture"]["pinned"] is False, (
                "a never-pinned row panel must not carry the pinned marker"
            )
            assert attrs["fixture"]["position"] == "absolute", (
                "a never-pinned row panel must keep its row-anchored absolute "
                f"box, got {attrs['fixture']}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_row_panel_horizontal_box_and_flip(self, browser, tmp_path):
        """The pinned card's horizontal box still obeys the card policy.

        The card is right-aligned with its row while the map is wide, shrinks to
        the map's 8px edge inset when the map is narrower than the card, and
        still flips above its row on a short map. The measured box is compared
        against the map and the anchor row, never a hardcoded coordinate.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="row_panel_geometry",
        ) as (page, errors):
            page.set_viewport_size({"width": 900, "height": 720})
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            opened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert opened["ok"], f"style panel did not open: {opened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            page.wait_for_timeout(200)

            wide = page.evaluate(_js("LayerControl/row_panel_geometry"))
            assert wide["panel"] is not None, wide
            # Right-aligned with its row: the card's right edge is the row's.
            assert abs(wide["panel"]["right"] - wide["row"]["right"]) <= 1, wide
            assert wide["maxWidth"] == "", wide
            assert wide["panel"]["left"] >= wide["map"]["left"] + 7.5, wide
            assert wide["panel"]["right"] <= wide["map"]["right"] - 7.5, wide

            page.set_viewport_size({"width": 260, "height": 600})
            page.wait_for_timeout(400)
            narrow = page.evaluate(_js("LayerControl/row_panel_geometry"))
            map_box, card = narrow["map"], narrow["panel"]
            assert narrow["maxWidth"] != "", narrow
            assert abs(card["width"] - (map_box["width"] - 16)) <= 1, narrow
            assert abs(card["left"] - (map_box["left"] + 8)) <= 1, narrow
            assert abs(card["right"] - (map_box["right"] - 8)) <= 1, narrow

            page.set_viewport_size({"width": 260, "height": 320})
            page.wait_for_timeout(400)
            short = page.evaluate(_js("LayerControl/row_panel_geometry"))
            assert short["flipped"] is True, short
            assert abs(short["panel"]["top"] - (short["map"]["top"] + 8)) <= 1, short
            assert short["panel"]["bottom"] <= short["map"]["bottom"] - 8, short
            assert not errors, f"JS errors: {errors}"


class TestStylePanelTouchBrowser:
    def test_touch_drag_over_the_style_panel_does_not_pan_the_map(
        self, touch_browser, tmp_path
    ):
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_value_1")),
            name="Polygon data",
        )
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        layer.add_to(m)
        html = m.get_root().render()
        with use_page(make_browser_page, touch_browser, tmp_path, html, "style") as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(
                "document.querySelector('.foliplus-layer-ctrl .foliplus-toggle-btn')?.click()"
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(200)
            # Open the row menu, then the Style panel on the first overlay row.
            page.evaluate(snippet("LayerControl/open_layer_style_panel"))
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            rect = page.evaluate(
                f"({snippet_fn('common/element_rect')})"
                "('.foliplus-layer-style-panel .foliplus-panel-content')"
            )
            before = map_center_zoom(page)
            touch_drag(
                page,
                rect["x"] + rect["w"] / 2,
                rect["y"] + rect["h"] / 2,
                rect["y"] + rect["h"] / 2 - 80,
            )
            page.wait_for_timeout(300)
            assert_map_unchanged(before, map_center_zoom(page))
            assert not errors, f"JS errors: {errors}"
