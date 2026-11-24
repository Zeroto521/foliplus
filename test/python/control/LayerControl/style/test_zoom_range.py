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
from ..helper import _expand_panel, _geo_zone, _tiny_png, _write_html
from ..helper_browser import LayerControlBrowserBase

class TestStyleBrowser(LayerControlBrowserBase):
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
