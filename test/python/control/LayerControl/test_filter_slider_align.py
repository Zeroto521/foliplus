"""Filter panel range slider alignment (regression test).

The filter panel's range body is the one slider row whose end labels align by
display width: a one-column label (a bare digit) stays dot-centred — its
centre sits on the parked dot's centre, half a thumb in from the control
edge — and a label two columns or wider clamps to the slider's painted ends.

The clamp reference is the CONTROL edge, not the track element's edge. The
track is inset half a thumb so a parked thumb's outer edge lands on the
control's edge, which means the painted bar (rail plus the two parked
thumbs) spans the full control width. Pinning a clamped label to the track
element instead leaves it half a thumb inside the bar's visible end — the
misalignment this test exists to catch.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, panel_ready, use_page

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestFilterRangeSliderLabelAlignment(LayerControlBrowserBase):
    """The filter range slider's end labels sit on the control's two edges."""

    def test_filter_range_slider_labels_flush_with_control(self, browser, tmp_path):
        """End labels align by display width: one column centres, wider clamps.

        The filter panel's range body is measured in the live panel, where the
        form row gives the slider its real width. The probe registers two range
        owners (a one-column/long pair and a both-long pair): the one-column
        label stays dot-centred, every two-column-or-wider label clamps to the
        track's end.
        """
        layer = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "mixed")), name="Filter align"
        )
        with use_page(self._make_page, browser, tmp_path, layer) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/read_filter_slider_alignment"))
            assert result.get("error") is None, f"setup failed: {result}"
            for name, group in (("mixed", result["mixed"]), ("both", result["both"])):
                assert group.get("error") is None, f"{name}: {group}"
                min_label, max_label = group["min"], group["max"]
                assert min_label is not None and max_label is not None, group
                track = group["track"]
                values = group["values"]
                # A hidden panel measures every box as zero, and a zero-vs-
                # zero comparison passes every alignment assertion below —
                # the vacuous green this guard exists to prevent.
                assert values["width"] > 0, f"{name}: slider row has no width: {values}"
                assert track["width"] > 0, f"{name}: track has no width: {track}"
                # Two references, one per state. A one-column label centres
                # on its dot, and a parked dot's centre IS the track edge, so
                # the dot-centred check reads the track. A clamped label is an
                # axis label and pins to the slider's painted ends: the track
                # is inset half a thumb, so the painted bar (rail plus the two
                # parked thumbs) spans the full control width — the row box.
                # Pinning to the track edge instead leaves the label half a
                # thumb inside the bar's visible end, which is the
                # misalignment this test exists to catch.
                for label, dot, edge, control_edge in (
                    (min_label, track["left"], "left", values["left"]),
                    (max_label, track["right"], "right", values["right"]),
                ):
                    if len(label["text"]) == 1:
                        assert not label["clamp"], (
                            f"{name} min {label['text']!r} clamped: {label}"
                        )
                        drift = abs(label["cx"] - dot)
                        assert drift <= 1.0, (
                            f"{name} {label['text']!r} not centred on its dot: "
                            f"{label['cx']:.2f}px vs {dot:.2f}px (drift {drift:.2f}px)"
                        )
                    else:
                        assert label["clamp"], (
                            f"{name} {label['text']!r} not clamped: {label}"
                        )
                        assert abs(label[edge] - control_edge) <= 1.0, (
                            f"{name} {label['text']!r} not flush the slider's "
                            f"painted {edge} end: {label} vs control "
                            f"{control_edge:.2f}px"
                        )
            assert not errors, f"JS errors: {errors}"
