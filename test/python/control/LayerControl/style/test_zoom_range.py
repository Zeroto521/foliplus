"""Split of test_style.py by dimension."""

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

def _method_labels() -> tuple[str, str]:
    """The method row label for each built-in language, read from the locale
    table (single source — never pin the string twice)."""
    base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
    en = json.loads((base / "common.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "common.zh.json").read_text(encoding="utf-8"))
    return en["foliplus.classification_method"], zh["foliplus.classification_method"]

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
    def test_zoom_range_dual_thumb_clamp(self, browser, tmp_path):
        """Two thumbs never cross: each drag really moves, then clamps.

        The probe presses a thumb at its current value and moves to the target
        (a press at the target would pick a thumb by side instead of grabbing
        the one asked for), and uses one layer per direction so the second drag
        does not start on an already-merged pair.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/zoom_range_dual_thumb_clamp"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["forwardMoved"], (
                f"the forward drag never changed a value: {result}"
            )
            assert result["clampForward"], (
                f"min did not clamp to max when dragged past: {result}"
            )
            assert result["minAfterCross"] == result["maxAfterCross"], result
            assert result["reverseMoved"], (
                f"the reverse drag never changed a value: {result}"
            )
            assert result["clampReverse"], (
                f"max did not clamp to min when dragged below: {result}"
            )
            assert result["storedForward"] == [
                result["minAfterCross"],
                result["maxAfterCross"],
            ], f"forward range was not persisted: {result}"
            assert result["storedReverse"] == [
                result["minAfterReverse"],
                result["maxAfterReverse"],
            ], f"reverse range was not persisted: {result}"
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
    def test_zoom_range_oor_dim(self, browser, tmp_path):
        """Out-of-range: only the selected span dims; the thumbs, rail and
        numbers stay crisp, the current dot greys, and the title explains."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/zoom_range_oor_dim"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert result["rowOor"] is True, f"row not marked out-of-range: {result}"
            assert result["rowTitle"], "row tooltip missing when out of range"
            assert result["markerLabelText"], "current-zoom label missing from marker"
            # Only the selected span dims (opacity), and its color is untouched:
            # the fill still reads as accent, just at half strength. The thumbs
            # and the numbers are not recolored.
            assert result["fillOpacity"] == "0.5", (
                "out of range, the selected span must dim to alpha-50"
            )
            assert result["fillComputedBg"] != self._sample_token(
                page, "--foliplus-neutral-500"
            ), "out of range must not gray the selection"
            assert result["currentValueColor"] == self._sample_token(
                page, "--foliplus-text-primary"
            ), "out of range must not recolor the current level"
            assert result["markerRing"] == self._sample_token(
                page, "--foliplus-neutral-500"
            ), "out of range, the current dot must read as uncovered"
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
    def test_slider_scale_ends_centered_on_their_thumbs(self, browser, tmp_path):
        """The end numbers align by rendered width: narrower centres, wider clamps.

        The alignment rule keys on the label's rendered width against the
        thumb's width: a label no wider than the thumb (a bare digit like
        "0") centres on the dot it names (its centre sits on the parked
        thumb's centre, a half thumb in from the control edge); a label wider
        than the thumb is an axis label that pins to the slider's painted
        end (its outer edge sits on the control edge, where the parked
        thumb's outer edge lands). The values row spans the control's width
        (no half-thumb inset). The row must not be widened by the labels,
        the two numbers must not overlap, and each label stays inside the
        row's own box. The dual zoom-range row also owns the current-level
        number, which the centred layout keeps over the track.
        """
        overlay = folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Overlay",
            overlay=True,
            show=True,
        )
        with use_page(
            self._make_page, browser, tmp_path, overlay, slug="slider_label_center"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            result = page.evaluate(_js("LayerControl/read_slider_label_alignment"))
            assert result.get("error") is None, f"setup failed: {result}"

            def check_row(name, row, thumbs, mirrored=False):
                assert row is not None, f"the {name} row did not render: {result}"
                assert row.get("error") is None, f"{name} row: {row}"
                assert len(row["thumbs"]) == thumbs, (
                    f"the {name} row does not have {thumbs} thumb(s): {row}"
                )
                # A zero-width row would pass every alignment assertion below
                # (zero-vs-zero), so the geometry guards come first.
                assert row["values"]["width"] > 0, (
                    f"{name} slider row has no width: {row['values']}"
                )
                assert row["track"]["width"] > 0, (
                    f"{name} track has no width: {row['track']}"
                )
                labels = row["labels"]
                # A mirrored row keeps the logical anchors, so the minimum
                # names the right edge and the maximum the left one.
                min_label = labels["min"]
                max_label = labels["max"]
                assert min_label is not None, f"{name} has no min number: {row}"
                assert max_label is not None, f"{name} has no max number: {row}"
                assert min_label["visible"], f"{name} min number is hidden: {row}"
                assert max_label["visible"], f"{name} max number is hidden: {row}"
                # The two labels must not overlap.
                if mirrored:
                    assert (
                        max_label["box"]["right"] <= min_label["box"]["left"] + 0.5
                    ), (
                        f"{name} end numbers overlap: {min_label['box']} vs "
                        f"{max_label['box']}"
                    )
                else:
                    assert (
                        min_label["box"]["right"] <= max_label["box"]["left"] + 0.5
                    ), (
                        f"{name} end numbers overlap: {min_label['box']} vs "
                        f"{max_label['box']}"
                    )

                # The min names the first thumb, the max the last. The width rule
                # decides the label's alignment: a label no wider than the thumb
                # (a bare digit) centres on its dot (<= 1px); anything wider is
                # an axis label and pins to the row's edge (its outer box sits
                # on the values row's edge).
                def centre(box):
                    return (box["left"] + box["right"]) / 2

                # The end dots are the rail ends: the min dot sits on the
                # track's left edge, the max dot on its right edge, whatever
                # the thumb count (a single-thumb opacity row parks its only
                # thumb at the current value, not at a rail end). In RTL the
                # logical anchors swap, so the min dot moves to the right edge.
                if not mirrored:
                    min_dot = row["track"]["left"]
                    max_dot = row["track"]["right"]
                else:
                    min_dot = row["track"]["right"]
                    max_dot = row["track"]["left"]
                thumb_width = row["thumbs"][0]["box"]["width"]
                # The alignment rule keys on the label's rendered width
                # against the thumb's width: a label no wider than the thumb
                # (a bare digit like "0") centres on its dot; anything wider
                # is an axis label and pins to the slider's painted end. The
                # two states read different references: a dot-centred label's
                # centre sits on the track edge (the parked thumb's centre),
                # while a pinned label's outer edge sits on the control edge
                # (where the parked thumb's outer edge lands). The dot already
                # encodes the mirror.
                # A clamped label pins to the slider's PAINTED end, which is
                # the control edge (the values row's edge), not the track
                # element's edge: the track is inset half a thumb so a parked
                # thumb's outer edge lands on the control edge, and the painted
                # bar (rail plus the two parked thumbs) therefore spans the
                # full control width. Pinning to the track edge instead leaves
                # the label half a thumb inside the bar's visible end.
                # The alignment state is decided by the same width comparison
                # the slider performs: label width vs thumb width.
                for label, dot, side in (
                    (min_label, min_dot, "min"),
                    (max_label, max_dot, "max"),
                ):
                    if label["box"]["width"] <= thumb_width:
                        drift = abs(centre(label["box"]) - dot)
                        assert drift <= 1.0, (
                            f"{name} {side} number is not centred on its dot: "
                            f"{centre(label['box']):.2f}px vs "
                            f"{dot:.2f}px (drift {drift:.2f}px)"
                        )
                    else:
                        flush_edge = "left" if (side == "min") != mirrored else "right"
                        label_edge = label["box"][flush_edge]
                        dot = row["values"][flush_edge]
                        assert abs(label_edge - dot) <= 1.0, (
                            f"{name} {side} axis label is not flush the control edge ({flush_edge}): "
                            f"{label['box']} vs dot {dot:.2f}px"
                        )
                # own width (that is the layout's design: the anchor is a half
                # thumb in from the row edge). The panel's clip box is the real
                # boundary; the live panel's numbers are short, so each label
                # stays inside the clip. Each label must not cross the track's
                # opposite end.
                # Each label's centre must stay between the two dots (a
                # dot-centred label may overhang its own dot by half its
                # width, but it cannot cross the opposite dot).
                assert centre(min_label["box"]) >= min(min_dot, max_dot) - 0.5, (
                    f"{name} min number crosses the max dot: {min_label['box']}"
                )
                assert centre(min_label["box"]) <= max(min_dot, max_dot) + 0.5, (
                    f"{name} min number crosses the max dot: {min_label['box']}"
                )
                assert centre(max_label["box"]) >= min(min_dot, max_dot) - 0.5, (
                    f"{name} max number crosses the min dot: {max_label['box']}"
                )
                assert centre(max_label["box"]) <= max(min_dot, max_dot) + 0.5, (
                    f"{name} max number crosses the min dot: {max_label['box']}"
                )
                # Not widened: the slider is the track plus the half-thumb
                # inset on each side, and the values row spans the control's
                # width (it no longer takes the inset).
                slider, track = row["slider"], row["track"]
                assert abs(slider["width"] - (track["width"] + thumb_width)) <= 1.0, (
                    f"the {name} slider was widened: {slider} vs track {track}"
                )
                assert abs(row["values"]["width"] - slider["width"]) <= 1.0, (
                    f"the {name} values row no longer spans the control: {row}"
                )

            check_row("opacity", result["opacity"], thumbs=1)
            check_row("zoom range", result["zoomRange"], thumbs=2)

            # The dual row keeps the current-level number the centred layout had.
            current = result["zoomRange"]["labels"]["current"]
            assert current is not None, f"zoom range lost its current number: {result}"

            # The current-level number must centre on its OWN dot, not on the
            # track or a hardcoded offset: the dot rides the track (inset by half
            # a thumb) while the label sits in the full-width values row, so a
            # percentage of the row alone would drift by that inset. Read the
            # dot's own centre from the probe.
            current_dot = next(
                (d for d in result["zoomRange"]["dots"] if d.get("tone") == "current"),
                None,
            )
            assert current_dot is not None, f"zoom range lost its current dot: {result}"

            def centre(box):
                return (box["left"] + box["right"]) / 2

            current_drift = abs(centre(current["box"]) - current_dot["box"]["cx"])
            assert current_drift <= 0.5, (
                "the current-level number is not centred on its dot: "
                f"{centre(current['box']):.2f}px vs "
                f"{current_dot['box']['cx']:.2f}px "
                f"(drift {current_drift:.2f}px)"
            )

            # A mirrored page keeps the same invariant: the logical anchors
            # swap sides, the physical dot-centre flips with them, so every
            # number still centres on the dot it names.
            page.evaluate(_js("LayerControl/set_document_dir_rtl"))
            mirrored = page.evaluate(_js("LayerControl/read_slider_label_alignment"))
            assert mirrored.get("error") is None, f"RTL setup failed: {mirrored}"
            check_row("opacity (rtl)", mirrored["opacity"], thumbs=1, mirrored=True)
            check_row(
                "zoom range (rtl)", mirrored["zoomRange"], thumbs=2, mirrored=True
            )

            current_dot_rtl = next(
                (
                    d
                    for d in mirrored["zoomRange"]["dots"]
                    if d.get("tone") == "current"
                ),
                None,
            )
            assert current_dot_rtl is not None, (
                f"zoom range (rtl) lost its current dot: {mirrored}"
            )
            current_rtl = mirrored["zoomRange"]["labels"]["current"]
            assert current_rtl is not None, (
                f"zoom range (rtl) lost its current number: {mirrored}"
            )
            current_drift_rtl = abs(
                centre(current_rtl["box"]) - current_dot_rtl["box"]["cx"]
            )
            assert current_drift_rtl <= 0.5, (
                "the current-level number (rtl) is not centred on its dot: "
                f"{centre(current_rtl['box']):.2f}px vs "
                f"{current_dot_rtl['box']['cx']:.2f}px "
                f"(drift {current_drift_rtl:.2f}px)"
            )
            assert not errors, f"JS errors: {errors}"
