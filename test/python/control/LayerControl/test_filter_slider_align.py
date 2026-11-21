"""Filter panel range slider alignment (regression test).

The filter panel's range body is the one slider row whose end labels the user
wants pinned to the control's two edges: the left label's left edge sits on
the control's left edge (the left dot's outer edge) and the right label's
right edge on the control's right edge. Before the fix the labels were
dot-centred (their centre on the parked dot's centre, half a thumb in from
the row edge), so each overhung the control edge by half its own width.
"""

from __future__ import annotations

import folium
from conftest import _js, panel_ready, use_page

from foliplus import LayerControl

from ._browser_base import LayerControlBrowserBase


class TestFilterRangeSliderLabelAlignment(LayerControlBrowserBase):
    """The filter range slider's end labels sit on the control's two edges."""

    def test_filter_range_slider_labels_flush_with_control(self, browser, tmp_path):
        """Both end labels pin to the control's two edges, never the track's.

        The filter panel's range body is measured in the live panel, where the
        form row gives the slider its real width. The probe registers two range
        owners (a short/long pair and a both-long pair); both must clamp their
        labels to the control's edges regardless of label width.
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
                values = group["values"]
                # The end labels always clamp to the control's two edges
                # (user rule: the left label's left edge sits on the control's
                # left edge, the right label's right edge on the control's
                # right edge). The values row spans the control width, so its
                # edges are the reference — NOT the track edges (the track is
                # inset half a thumb, so a track-end pin would leave the label
                # half a thumb in from the control edge).
                assert min_label["clamp"], f"{name} min not clamped: {min_label}"
                assert max_label["clamp"], f"{name} max not clamped: {max_label}"
                assert abs(min_label["left"] - values["left"]) <= 1.0, (
                    f"{name} min label not flush the control start: "
                    f"{min_label} vs values {values}"
                )
                assert abs(max_label["right"] - values["right"]) <= 1.0, (
                    f"{name} max label not flush the control end: "
                    f"{max_label} vs values {values}"
                )
            assert not errors, f"JS errors: {errors}"
