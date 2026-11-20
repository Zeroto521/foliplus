"""Filter panel range slider alignment (regression test).

The filter panel's range body is the one slider row whose end labels can be
in a mixed state: one label fits on its half (dot-centred, out of flow) while
the other is an axis label (clamped). A clamped label must stay flush with
its own rail end; before the fix a lone clamped label was the only flex child
and space-between pinned it to the row's start edge.
"""

from __future__ import annotations

import folium
from conftest import _js, panel_ready, use_page

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestFilterRangeSliderLabelAlignment(LayerControlBrowserBase):
    """The filter range slider's end labels sit on the rail's end dots."""

    def test_filter_range_slider_labels_flush_with_track(self, browser, tmp_path):
        """A clamped label pins to its track end, a dot-centred one to its dot.

        The filter panel's range body is measured in the live panel, where the
        form row gives the slider its real width. The probe registers two range
        owners: a mixed pair (short min / long max) and a both-clamped pair.
        """
        layer = folium.FeatureGroup(name="Filter align")
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
                # A clamped label pins to the track's end: its outer edge sits
                # on the rail end (the dot's centre), never on the row's edge.
                if min_label["clamp"]:
                    assert abs(min_label["left"] - track["left"]) <= 1.0, (
                        f"{name} clamped min not flush the track start: "
                        f"{min_label} vs track {track}"
                    )
                if max_label["clamp"]:
                    assert abs(max_label["right"] - track["right"]) <= 1.0, (
                        f"{name} clamped max not flush the track end: "
                        f"{max_label} vs track {track}"
                    )
                # A dot-centred label's centre sits on its dot (the rail end).
                if not min_label["clamp"]:
                    assert (
                        abs(
                            (min_label["left"] + min_label["right"]) / 2 - track["left"]
                        )
                        <= 1.0
                    ), f"{name} dot-centred min not on its dot: {min_label}"
                if not max_label["clamp"]:
                    assert (
                        abs(
                            (max_label["left"] + max_label["right"]) / 2
                            - track["right"]
                        )
                        <= 1.0
                    ), f"{name} dot-centred max not on its dot: {max_label}"
                # The row must still span the control (no inset change).
                assert abs(values["width"] - group["track"]["width"] - 14) <= 1.5, (
                    f"{name} values row lost its control span: {values}"
                )
            assert not errors, f"JS errors: {errors}"
