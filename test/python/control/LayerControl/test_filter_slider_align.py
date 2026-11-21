"""Filter panel range slider alignment (regression test).

The filter panel's range body is the one slider row whose end labels align by
display width: a one-column label (a bare digit) stays dot-centred — its
centre sits on the parked dot's centre, half a thumb in from the control
edge — and a label two columns or wider clamps to the track's end (its outer
edge on the track edge). Before the fix the labels were pinned to the
control's two edges, so a one-column label read as the row's edge rather
than the value at its dot.
"""

from __future__ import annotations

import folium
from conftest import _js, panel_ready, use_page

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
                # The alignment rule keys on display width (a CJK glyph counts
                # 2 columns, everything else 1): a one-column label (a bare
                # digit) stays dot-centred — its centre sits on the parked
                # dot's centre, the track edge; a label two columns or wider
                # clamps to the track's end (its outer edge on the track edge).
                # The reference is the track edge (the dot's centre), never the
                # control edge (the track is inset half a thumb).
                for label, dot, edge in (
                    (min_label, track["left"], "left"),
                    (max_label, track["right"], "right"),
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
                        assert abs(label[edge] - dot) <= 1.0, (
                            f"{name} {label['text']!r} not flush the track end "
                            f"({edge}): {label} vs track {dot:.2f}px"
                        )
            assert not errors, f"JS errors: {errors}"
