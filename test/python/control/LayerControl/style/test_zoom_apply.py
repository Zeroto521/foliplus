"""Zoom-range application: native gate, bubbles, drag commits and layer/canvas reload behaviour."""

from __future__ import annotations

import base64
import copy
import json
import re
import time
from pathlib import Path

import folium
import pytest
from conftest import (
    _js,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    load_geojson,
    make_browser_page,
    panel_ready,
    point_feature,
    render,
    snippet,
    use_page,
    use_raw_page,
)

from foliplus import HeatmapControl, LayerControl

from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase


class TestStyleBrowser(LayerControlBrowserBase):
    def test_native_gate_range_slider_arrowdown(self, browser, tmp_path):
        """ArrowDown on a focused zoom-range thumb moves the thumb, never the row cursor.

        Row 1 of the input-ownership table, exercised through Chromium's real
        keyboard pipeline: the key is pressed with ``page.keyboard`` after a
        real focus, and a capture listener reports the browser's final
        ``defaultPrevented``. Both halves of the gate are measured — the thumb
        actually stepped, and the row cursor did not follow the keypress.
        Synthetic ``dispatchEvent`` cannot prove either.
        """
        overlay = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Overlay A",
            overlay=True,
            show=True,
        )
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
            assert arm["sliderBefore"] > arm["sliderMin"], (
                "the thumb rests on its floor, so ArrowDown has nowhere to go: "
                + str(arm)
            )
            assert arm["focusedType"] == "slider", f"slider thumb not focused: {arm}"

            page.keyboard.press("ArrowDown")

            mid = page.evaluate(_js("LayerControl/native_gate_mid"))
            assert mid["sliderAfter"] == arm["sliderBefore"] - arm["sliderStep"], (
                "the thumb did not step down natively: before="
                + str(arm["sliderBefore"])
                + " after="
                + str(mid["sliderAfter"])
            )
            read = page.evaluate(_js("LayerControl/native_gate_read"))
            recs = [r for r in (read["records"] or []) if r["key"] == "ArrowDown"]
            assert len(recs) == 1, (
                f"ArrowDown observed {len(recs)} times: {read['records']}"
            )
            # The custom slider owns ArrowDown: cancel page scrolling, but let
            # the key bubble (the shared dispatcher stands aside by ownership).
            assert recs[0]["prevented"] is True, (
                "the slider must cancel the page default for ArrowDown: "
                + str(read["records"])
            )
            assert recs[0]["type"] == "slider", str(read["records"])
            # The cursor is compared against its pre-press baseline, not against
            # "absent": opening the style panel and focusing the checkbox both
            # legitimately light the row cursor, so only a change is in scope.
            assert mid["rowFocused"] == arm["rowFocused"], (
                "the row keyboard cursor moved while the slider was focused: "
                "before=" + str(arm["rowFocused"]) + " after=" + str(mid["rowFocused"])
            )
            assert not errors, f"JS errors: {errors}"

    def test_slider_pan_shows_following_bubbles(self, browser, tmp_path):
        """A pan keeps both value bubbles live and following their thumbs.

        The middle segment drags the pair; the acceptance is that both bubbles
        are on screen at once, each tracking its thumb across a continuous
        move (a placement that only ran at the pan's start would not move), and
        that both clear on release.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/pan_bubble_follow"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["countA"] == 2, (
                f"expected 2 live bubbles on pan start: {result}"
            )
            assert result["countB"] == 2, (
                f"expected 2 live bubbles after the move: {result}"
            )
            assert result["moved0"], (
                f"the lower bubble did not follow its thumb: {result}"
            )
            assert result["moved1"], (
                f"the upper bubble did not follow its thumb: {result}"
            )
            assert result["text0"] == result["aria0"], (
                f"lower bubble text does not match its thumb: {result}"
            )
            assert result["text1"] == result["aria1"], (
                f"upper bubble text does not match its thumb: {result}"
            )
            assert result["countAfterUp"] == 0, (
                f"bubbles did not clear on release: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_slider_bubble_clears_on_window_blur(self, browser, tmp_path):
        """A drag interrupted by the window losing focus leaves no bubble.

        The probe presses a thumb and never releases it, then dispatches the
        window blur an alt-tab delivers. Without a retire path the drag session
        and the portalled bubble both survive, so the user sees a readout
        reappear on a row they have not touched. The assertions cover the
        visible result (no live bubble, no leftover node), the drag state, and
        that returning to the page neither revives the bubble nor blocks the
        next gesture.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/blur_bubble_retire"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["liveBefore"] == 1, (
                f"the probe did not start a drag with a visible bubble: {result}"
            )
            assert result["draggingBefore"] is True, result
            assert result["textBefore"] is not None, result
            assert result["liveAfterBlur"] == 0, (
                f"the bubble survived the window blur: {result}"
            )
            assert result["draggingAfterBlur"] is False, (
                f"the drag state survived the window blur: {result}"
            )
            assert result["nodesAfterBlur"] == 0, (
                f"the bubble node was left in the document: {result}"
            )
            # The reported symptom: it comes back. Returning re-fires focus at
            # the still-active thumb, which must not repaint the readout.
            assert result["liveAfterReturn"] == 0, (
                f"the bubble came back when the page was shown again: {result}"
            )
            assert result["nodesAfterReturn"] == 0, (
                f"a bubble node was painted again on return: {result}"
            )
            # ... but real input still shows it: the fix refuses the browser's
            # automatic restore, it does not mute the control.
            assert result["keyboardWorks"] is True, (
                f"real input no longer shows the readout: {result}"
            )
            assert result["resumed"] is True, (
                f"the slider no longer responds after the interrupt: {result}"
            )
            assert result["nodesAfterResume"] == 0, (
                f"the resumed drag left a bubble behind: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_close_mid_drag_commits(self, browser, tmp_path):
        """Closing the panel while a drag is live commits what the pointer set.

        The pointer is never released, so only the close can emit the change.
        The assertions distinguish the in-memory preview (written by input,
        unmarked) from the committed state (user override, debounced record).
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/close_mid_drag"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["afterMove"] == result["target"], (
                f"the drag did not reach the target: {result}"
            )
            assert result["markedBefore"] is False, (
                f"an uncommitted preview must not be a user override: {result}"
            )
            assert result["draggingBefore"] is True, (
                f"the probe did not start a drag: {result}"
            )
            assert result["panelGone"] is True, result
            assert result["markedAfter"] is True, (
                f"closing mid-drag did not mark the user override: {result}"
            )
            assert result["draggingAfter"] is False, (
                f"the retained host kept its dragging state: {result}"
            )
            assert result["storedAfterClose"] == [
                result["minAfterClose"],
                result["afterMove"],
            ], f"the committed range is wrong: {result}"
            disk = result.get("disk")
            assert disk is not None, (
                f"closing mid-drag did not write the record: {result}"
            )
            assert "zoomRange" in (disk["overrides"] or []), disk
            assert disk["zoomRange"] == [
                result["minAfterClose"],
                result["afterMove"],
            ], f"the stored range is wrong: {disk}"
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_zoomend_marker_moves(self, browser, tmp_path):
        """Current-zoom marker follows the map on zoomend."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/zoom_range_zoomend_marker"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["markerMoved"] is True, (
                f"marker did not move on zoomend: {result}"
            )
            assert result["labelUpdated"] is True, (
                f"current-zoom label did not update on zoomend: {result}"
            )
            assert result["afterCovered"] is True, (
                f"current dot missing after zoomend: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_native_tilelayer(self, browser, tmp_path):
        """Native carrier: GridLayer minZoom/maxZoom hides tiles on reset."""
        t1 = folium.TileLayer(
            tiles="https://tiles.foliplus.test/{z}/{x}/{y}.png",
            name="NativeProbe",
            attr="Foliplus zoom range probe",
        )
        with use_page(self._make_page, browser, tmp_path, t1, slug="zr_nat") as (
            page,
            errors,
        ):
            page.route(
                "https://tiles.foliplus.test/**",
                lambda route: route.fulfill(
                    status=200,
                    body=base64.b64decode(_tiny_png.split(",", 1)[1]),
                    content_type="image/png",
                ),
            )
            panel_ready(page)
            page.evaluate(_js("LayerControl/set_probe"), {"id": t1.get_name()})
            result = page.evaluate(_js("LayerControl/zoom_range_native_tilelayer"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["before"] > 0, (
                f"no tiles loaded before range was set: {result}"
            )
            # The native branch: options write + adapter _resetView.
            # Leaflet does not self-apply options.minZoom changes — the
            # adapter reset is what makes the range visible.
            assert result["tilesCleared"] is True, (
                f"tiles not cleared after options + _resetView with "
                f"out-of-range minZoom: {result}"
            )
            assert result["restoredOk"] is True, (
                f"tiles not restored after deleting options + _resetView: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_zoomend_does_not_add_author_hidden_layer(
        self, browser, tmp_path
    ):
        """Gate 1: a folium ``show=False`` layer stays off the map through a
        zoomend sweep.

        The regression: the sweep's ``applyLayerState({visible: true})``
        unconditionally added a layer the author left off the map, while the
        checkbox stayed unchecked. The one-way gate must leave it alone.
        """
        fg = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="ZROffProbe",
            overlay=True,
            show=False,
        )
        with use_page(self._make_page, browser, tmp_path, fg, slug="zr_off") as (
            page,
            errors,
        ):
            panel_ready(page)
            # Get the layer's actual id (folium generates one).
            actual_id = page.evaluate(_js("LayerControl/find_zroffprobe_id"))
            if not actual_id:
                raise AssertionError("ZROffProbe layer not found in registry")
            # Re-set probe with the actual id.
            page.evaluate(_js("LayerControl/set_probe"), {"id": actual_id})
            result = page.evaluate(_js("LayerControl/show_false_zoom_stays_off"))
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            # folium 0.14 adds every layer regardless of show=False, so
            # beforeOnMap may be true on that version. The invariant is that
            # the sweep doesn't change the layer's map membership.
            assert result["stateUnchanged"] is True, (
                f"layer map membership changed during zoom sweep: {result}"
            )
            assert result["rowConsistent"] is True, (
                f"row checkbox state drifted during the sweep: {result}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_zoom_range_reload_does_not_add_author_hidden_layer(
        self, browser, tmp_path
    ):
        """Gate 2: a ``show=False`` layer with a stored zoomRange does not
        come back on the map after reload.

        The load path runs ``applyZoomRangeStateOne`` for every layer with
        a stored zoomRange. A stored zoom-range intent alone is not authorization
        to re-add a layer the author left off the map — only ``applyUserState``'s
        unhide branch (a visible override present) is.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="ZROffReload",
            overlay=True,
            show=False,
        ).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_zr_off_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Inject a zoomRange override into localStorage for the show=False
            # layer, simulating a user who previously set a zoom range for it.
            # On reload, applyUserState will restore this entry and run
            # applyZoomRangeStateOne — which must NOT add the layer to the map.
            page.evaluate(_js("LayerControl/seed_zroffreload_storage"))
            # Capture the layer's map membership before reload.
            before = page.evaluate(_js("LayerControl/read_zroffreload_on_map_nullable"))
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            # Read the layer's state after reload.
            result = page.evaluate(
                _js("LayerControl/read_zroffreload_on_map_with_error")
            )
            assert result is not None, "evaluation returned None"
            assert result.get("error") is None, f"setup failed: {result}"
            # folium 0.14 adds every layer regardless of show=False, so on
            # that version the layer may be on the map both before and after
            # reload. The invariant is that applyZoomRangeStateOne doesn't
            # ADD a layer the author left off — if folium already placed it,
            # the layer's state simply persists across reload.
            assert result["onMap"] == before, (
                f"layer map membership changed across reload: before={before}, after={result['onMap']}"
            )

    def test_zoom_range_canvas_row_hides_the_heatmap_canvas(self, browser, tmp_path):
        """A canvas-only layer gets a zoom-range row that really hides it.

        HeatmapControl registers through ``createCanvas``, so the range has no
        Leaflet layer to add or remove: its carrier is the canvas HIDDEN class,
        which the executor's ``visible`` op writes. Before 42.1 the row
        was gated off for every canvas surface, because capability alone could
        not tell "has content panes" from "canvas-only" (31.7) and the
        ``!li.canvas`` early return stood in for that distinction.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        folium.GeoJson(
            json.dumps(
                feature_collection(
                    *[
                        point_feature(119.30 + i * 0.01, 26.08, {"val": i})
                        for i in range(3)
                    ]
                )
            ),
            name="Points",
            show=True,
        ).add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        with use_page(
            make_browser_page, browser, tmp_path, m.get_root().render(), "zr_heatmap"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            result = page.evaluate(_js("LayerControl/zoom_range_heatmap_canvas"))
            assert result is not None, "probe returned None"
            assert result.get("error") is None, f"setup failed: {result}"

            # Drawer order: the rows LayerControl adds read before the rows the
            # component delegated, and among themselves they run
            # border -> opacity -> zoom range. No heading marks that split —
            # document order is the whole invariant now.
            assert result["layerBeforeLabel"] is True, (
                f"the Layer rows no longer precede the delegated Label rows: "
                f"{result['struct']}"
            )
            assert result["layerControls"] == ["border", "opacity", "zoomRange"], (
                f"layer rows are not border -> opacity -> zoom range: "
                f"{result['layerControls']} | skeleton: {result['struct']}"
            )

            # An untouched visit writes no zoom-range record at all: neither the
            # value nor a provenance marker.
            assert result["freshZoomRange"] is None, (
                f"an untouched visit stored a zoom range: {result}"
            )
            assert "zoomRange" not in (result["freshOverrides"] or []), (
                f"an untouched visit recorded a zoomRange override: "
                f"{result['freshOverrides']}"
            )

            # The live pass hides and restores through the canvas's own
            # visibility callback.
            assert result["visibleBefore"] is True, f"canvas started hidden: {result}"
            assert result["hiddenOut"] is True, (
                f"the canvas stayed visible out of range: {result}"
            )
            assert result["visibleBack"] is True, (
                f"the canvas stayed hidden after the range came back: {result}"
            )

            # The commit half lands in storage behind the write debounce.
            page.wait_for_timeout(300)
            stored = page.evaluate(
                _js("LayerControl/read_layer_storage_entry"), result["id"]
            )
            assert stored["stored"] == result["committed"], (
                f"the committed range did not reach storage: {stored}"
            )
            assert "zoomRange" in (stored["overrides"] or []), (
                f"the committed range carried no provenance marker: {stored}"
            )
            assert not errors, f"JS errors: {errors}"
