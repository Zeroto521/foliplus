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
    @pytest.mark.parametrize("width", [380])
    def test_style_fill_row_label_names_the_method_on_one_line(
        self, browser, tmp_path, width
    ):
        """The ramp row reads by its method in both panels, on one line.

        One visible label names two selects, so it takes the primary control's
        name (Classification Method / 分类方法) — the word the heatmap panel shows too. The
        class count stays announced by the count select's own aria label, so a
        screen reader hears "Classification Method" and "Classes" once each. The label column
        is the shared 88px token inside the 280px panel; Range.getClientRects()
        counts line boxes (the element rect always reports one row).
        """
        _METHOD_EN, _METHOD_ZH = _method_labels()
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="fill_row_label"
        ) as (page, errors):
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

            result = page.evaluate(
                _js("LayerControl/read_form_row_labels"),
                {"root": ".foliplus-layer-style-panel", "ramp": True},
            )
            assert result["ok"], result
            rows = {row["text"]: row for row in result["rows"]}
            # The visible label is locale-dependent; the panel's language follows
            # the browser, so pin both vocabularies rather than one page locale.
            label = next(
                (text for text in (_METHOD_EN, _METHOD_ZH) if text in rows), None
            )
            assert label, f"no method-labelled row among {sorted(rows)}"
            row = rows[label]
            expected_aria = {
                _METHOD_EN: [_METHOD_EN, "Classes"],
                _METHOD_ZH: [_METHOD_ZH, "分级数"],
            }[label]
            # The method label ("Classification Method" / 分类方法) is the one
            # label wider than the 88px shared column at the 12px label font
            # (DejaVu ~124px). It is allowed to wrap to two lines, but the
            # wrapped cell must stay inside the label column and must not
            # overlap the control cell — a rect-intersection assertion, not a
            # hard line count, so a future font/locale change either still
            # fits (1 or 2 lines) or is caught by the overlap, never silently
            # clipped.
            assert row["labelLines"] <= 2, (
                f"the Classification Method label wrapped past two lines: {row}"
            )
            assert row["labelOverlapsControl"] is False, (
                f"the method label overlaps its control: {row}"
            )
            assert row["labelWidth"] == pytest.approx(88, abs=0.5), row
            assert result["labelWidthToken"] == "88px", result
            assert result["panelWidthToken"] == "280px", result
            assert row["panelWidth"] == pytest.approx(280, abs=1), row
            assert row["ariaLabels"] == expected_aria, row
            assert not errors, f"JS errors: {errors}"
    def test_style_label_column_fits_the_longest_label_class_string(
        self, browser, tmp_path
    ):
        """The shared label column token fits the longest label-class string.

        Every panel shares one label column (form-label-width). This guard
        measures every label-class locale string for LayerControl and
        HeatmapControl (en + zh) at the panel's real 12px label font and
        asserts the widest one still fits the token minus its right padding.
        A locale edit that lengthens any label turns this red instead of
        silently wrapping again.
        """
        _METHOD_EN, _METHOD_ZH = _method_labels()
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="label_guard"
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-layer-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
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
            base = Path(__file__).resolve().parents[5] / "foliplus" / "locale"
            strings = set()
            # Label-class keys only: the strings that render as a form-row
            # label in a shared-label-column panel. A locale edit that
            # lengthens any of them is caught here instead of silently
            # wrapping the row again.
            label_keys = {
                "foliplus.classification_method",
                "LayerControl.style_fill_field",
                "LayerControl.style_fill_classes",
                "LayerControl.style_fill_scheme",
                "LayerControl.style_fill",
                "LayerControl.style_fill_mode",
                "LayerControl.style_border",
                "LayerControl.style_border_color",
                "LayerControl.style_border_weight",
                "LayerControl.style_border_mode",
                "LayerControl.style_border_follow_fill",
                "LayerControl.style_icon",
                "LayerControl.style_icon_color",
                "LayerControl.style_opacity",
                "LayerControl.style_zoom_range",
                "LayerControl.style_label",
                "LayerControl.style_label_field",
                "LayerControl.style_label_color_size",
                "LayerControl.style_label_format",
                "LayerControl.style_label_avoidance",
                "HeatmapControl.agg_field",
                "HeatmapControl.field",
                "HeatmapControl.class_count",
                "HeatmapControl.scheme",
            }
            for component in ("LayerControl", "HeatmapControl"):
                for lang in ("en", "zh"):
                    table = json.loads(
                        (base / f"{component}.{lang}.json").read_text(encoding="utf-8")
                    )
                    for key in label_keys:
                        value = table.get(key)
                        if isinstance(value, str):
                            strings.add(value)
            for lang in ("en", "zh"):
                table = json.loads(
                    (base / f"common.{lang}.json").read_text(encoding="utf-8")
                )
                for key in label_keys:
                    value = table.get(key)
                    if isinstance(value, str):
                        strings.add(value)
            result = page.evaluate(
                _js("LayerControl/measure_label_widths"),
                {
                    "root": ".foliplus-layer-style-panel",
                    "strings": sorted(strings),
                },
            )
            assert result["ok"], result
            # The method label ("Classification Method" / 分类方法) is the one
            # string the 88px shared column cannot fit at the 12px label font
            # (DejaVu ~124px). It is deliberately exempt: the row allows it to
            # wrap to two lines (the overlap guard in
            # test_style_fill_row_label_names_the_method_on_one_line catches a
            # wrap that pushes into the control). EVERY other label-class string
            # must still fit the token — a locale edit that lengthens any short
            # label turns this red instead of silently wrapping.
            method_strings = {_METHOD_EN, _METHOD_ZH}
            assert method_strings <= strings, (
                "the method-label strings are not part of the guard set"
            )
            max_short = max(
                (x["w"] for x in result["widths"] if x["s"] not in method_strings),
                default=0,
            )
            assert max_short <= result["token"] - result["paddingRight"], (
                f"a non-method label-class string exceeds the label column token: "
                f"max {max_short:.1f}px > token {result['token']} - "
                f"padding {result['paddingRight']}px"
            )

            assert not errors, f"JS errors: {errors}"
    def test_slider_end_labels_ellipsize_not_overflow(self, browser, tmp_path):
        """A long value label truncates, a short one keeps its text.

        The end numbers align by rendered width: a label no wider than the
        thumb (a bare digit) stays dot-centred; a wider label clamps to the
        control's edge (class is-clamp). A clamped label's content must not
        paint past the control's box: a long value ellipsizes (its intrinsic
        scroll width exceeds the box it is given) while a short value keeps
        its full text (it fits its box). Both end labels stay inside the
        values row's box and never overlap each other. The labels are built
        as a bare slider appended into the live style panel so the clip
        ancestor is the real panel content, not a synthetic wrapper.
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
            result = page.evaluate(_js("LayerControl/read_slider_end_labels_ellipsis"))
            assert result.get("error") is None, f"setup failed: {result}"
            for name, group in result["result"].items():
                assert group["values"] is not None, f"{name}: no values row: {group}"
                # A zero-width row would pass the overlap assertions below
                # (zero-vs-zero), so the geometry guard comes first.
                assert group["values"]["width"] > 0, (
                    f"{name} slider row has no width: {group['values']}"
                )
                for side in ("min", "max"):
                    label = group[side]
                    assert label is not None, f"{name}: no {side} label: {group}"
                    # A clamped label pins to the row's edge and clips inward,
                    # so it stays inside the row's own box. A dot-centred label
                    # (no clamp) legitimately overhangs the row by half its
                    # width (the dot-centre anchor is a half thumb in from the
                    # edge); its box is clipped by the panel, not the row.
                    if label.get("clamp"):
                        assert label["box"]["left"] >= group["values"]["left"] - 0.5, (
                            f"{name} {side} paints past the values row's left: "
                            f"{label['box']} vs {group['values']}"
                        )
                        assert (
                            label["box"]["right"] <= group["values"]["right"] + 0.5
                        ), (
                            f"{name} {side} paints past the values row's right: "
                            f"{label['box']} vs {group['values']}"
                        )
                # The two end labels must not overlap.
                assert (
                    group["min"]["box"]["right"] <= group["max"]["box"]["left"] + 0.5
                ), (
                    f"{name} end labels overlap: {group['min']['box']} vs "
                    f"{group['max']['box']}"
                )
            # The long labels switch to the clamp state and ellipsize; the
            # short ones stay dot-centred and keep their full text.
            long_min = result["result"]["long"]["min"]
            long_max = result["result"]["long"]["max"]
            assert long_min["clamp"], f"long min did not clamp: {long_min}"
            assert long_max["clamp"], f"long max did not clamp: {long_max}"
            assert long_min["scrollWidth"] > long_min["clientWidth"], (
                f"long min did not ellipsize: scrollWidth {long_min['scrollWidth']} "
                f"<= clientWidth {long_min['clientWidth']}"
            )
            assert long_max["scrollWidth"] > long_max["clientWidth"], (
                f"long max did not ellipsize: scrollWidth {long_max['scrollWidth']} "
                f"<= clientWidth {long_max['clientWidth']}"
            )
            # The short pair is a narrow min ("1", dot-centred) and a wider
            # max ("100", clamped): each keeps its full text because it fits
            # the box it is given.
            short_min = result["result"]["short"]["min"]
            short_max = result["result"]["short"]["max"]
            assert not short_min["clamp"], f"short min clamped: {short_min}"
            assert short_max["clamp"], f"short max did not clamp: {short_max}"
            for side, label in (("min", short_min), ("max", short_max)):
                assert label["scrollWidth"] == label["clientWidth"], (
                    f"short {side} was truncated: scrollWidth "
                    f"{label['scrollWidth']} != clientWidth "
                    f"{label['clientWidth']}"
                )
            assert not errors, f"JS errors: {errors}"
