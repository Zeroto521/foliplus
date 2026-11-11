"""Browser tests for foliplu            page.set_viewport_size({"width": width, "height": 900})
s.LayerControl — style panel, fill/border/color, zoom-range, attribution."""

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
    base = Path(__file__).resolve().parents[4] / "foliplus" / "locale"
    en = json.loads((base / "LayerControl.en.json").read_text(encoding="utf-8"))
    zh = json.loads((base / "LayerControl.zh.json").read_text(encoding="utf-8"))
    return en["LayerControl.style_method"], zh["LayerControl.style_method"]


from ._browser_base import LayerControlBrowserBase
from .helper import _expand_panel, _geo_mixed, _tiny_png, _write_html


class TestStyleBrowser(LayerControlBrowserBase):
    """Browser-level interaction checks — style panel, fill/border/color, zoom-range, attribution."""

    def test_opacity_pane_versus_features(self, browser, tmp_path):
        """One pane write per layer, and never onto a pane that is shared.

        After the ordering pass every overlay layer — a plain folium one
        included — owns a pane and has its content migrated into it, so the
        opacity is a single style write instead of a sweep over the features.
        The neighbor is the control: it is a different layer in a different
        pane and must be untouched.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/opacity_pane_isolation"),
                {
                    "hollow": load_geojson("LayerControl", "opacity_hollow"),
                    "annotated": load_geojson("LayerControl", "opacity_annotated"),
                    "neighbor": load_geojson("LayerControl", "opacity_neighbor"),
                    "managedLine": leaflet_path("LayerControl", "line_fuzhou_managed"),
                    "managedPoint": [26.085, 119.505],
                },
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"

            # Plain layer: its own pane carries the opacity...
            assert result["plainOpened"] is True, result
            assert result["plainPaneShared"] is False, result
            assert result["plainPaneBefore"] in ("", "1"), result
            assert result["plainPaneAfter"] == "0.4", result
            assert result["plainRegistryOpacity"] == 0.4, result
            # ...and the features keep their own style (no per-feature sweep).
            assert result["plainLeafOpacity"], result
            assert all(v == 1 for v in result["plainLeafOpacity"]), result
            # The neighbor is a different layer in a different pane.
            assert result["plainNeighbourSamePane"] is False, result
            assert result["plainNeighbourPaneOpacity"] in ("", "1"), result
            assert result["plainNeighbourLeafOpacity"], result
            assert all(v == 1 for v in result["plainNeighbourLeafOpacity"]), result

            # Managed layer: its declared panes carry it, one write each.
            assert result["managedOpened"] is True, result
            assert result["managedGraphPaneShared"] is False, result
            assert result["managedGraphPaneOpacity"] == "0.4", result
            assert result["managedNodePaneOpacity"] == "0.4", result
            assert result["managedPolylineOpacity"] == 1, result

            # Case C: a hollow polygon (fillOpacity: 0) keeps its hole — the
            # pane's CSS opacity is multiplicative at compositing time, not an
            # override of the feature's own style.  0 × 0.4 = 0.
            assert result["hollowPaneAfter"] == "0.4", result
            assert result["hollowFillOpacity"] == 0, result

            # Case D: label labels follow the layer's opacity via bake
            # (R11). The geometry pane carries CSS; the label pane is
            # excluded from CSS so it cannot double-compound, and the label
            # canvas carries the baked layerAlpha. A neighbor layer's
            # label pane is unaffected (per-layer pane, not shared).
            assert result["labelPaneExists"] is True, result
            assert result["annotatedGeoPaneOpacity"] == "0", result
            assert result["annotatedAnnotationPaneOpacity"] in ("", "1"), result
            assert result["annotatedLabelBakeAlpha"] == 0, result
            assert result["neighborAnnotationPaneExists"] is True, result
            assert result["neighborAnnotationPaneOpacity"] in ("", "1"), result
            assert not errors, f"JS errors: {errors}"

    def test_fill_two_layers_keep_their_own_color(self, browser, tmp_path):
        """A solid fill write on one layer never bleeds onto another layer.

        commitStyleDim / styleBag commit the fill by layer and surface in one
        batch, so a “write串” (A's color landing on B) is exactly the bug this
        guards. Two GeoJSON polygon layers are driven to distinct solid fills,
        then A is restyled and the OTHER pane's path fill/stroke must be
        byte-identical to its baseline — the hard “no cross-layer bleed”
        evidence, not just “B is still blue”. The map is read by grouping
        every SVG path by its owning pane (each layer migrates to its own pane).
        """

        def poly(name: str) -> folium.GeoJson:
            """One polygon layer with a numeric field so the fill row exists."""
            data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
            data["features"] = data["features"][:2]
            for i, feat in enumerate(data["features"]):
                feat["properties"] = {"value": i}
            return folium.GeoJson(json.dumps(data), name=name)

        first = poly("IsoLayerA")
        second = poly("IsoLayerB")
        with use_page(
            self._make_page, browser, tmp_path, first, second, slug="fill_two_layer_iso"
        ) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )

            # Baseline: give layer A a red solid fill.
            a_red = page.evaluate(
                _js("LayerControl/fill_two_layer_isolation"),
                {"targetLayer": "IsoLayerA", "color": "#ff0000"},
            )
            assert a_red.get("ok"), f"write A failed: {a_red}"
            assert len(a_red["panes"]) >= 2, f"expected 2 pane groups: {a_red}"

            # Give layer B a blue solid fill, then snapshot every pane.
            b_blue = page.evaluate(
                _js("LayerControl/fill_two_layer_isolation"),
                {"targetLayer": "IsoLayerB", "color": "#0000ff"},
            )
            assert b_blue.get("ok"), f"write B failed: {b_blue}"
            panes_before = {
                p["cls"]: (p["fills"], p["strokes"]) for p in b_blue["panes"]
            }
            assert len(panes_before) >= 2, f"pane groups: {b_blue}"

            # The two pane groups must not share a fill (distinct colors).
            all_fills = [set(p["fills"]) for p in b_blue["panes"]]
            assert all(len(s) == 1 for s in all_fills), f"not solid: {all_fills}"
            assert len({next(iter(s)) for s in all_fills}) == len(all_fills), (
                f"panes share a fill: {all_fills}"
            )

            # Restyle A to a third color; every OTHER pane stays byte-identical.
            a_green = page.evaluate(
                _js("LayerControl/fill_two_layer_isolation"),
                {"targetLayer": "IsoLayerA", "color": "#00ff00"},
            )
            assert a_green.get("ok"), f"re-write A failed: {a_green}"
            panes_after = {
                p["cls"]: (p["fills"], p["strokes"]) for p in a_green["panes"]
            }
            # Find the pane whose fill changed (A's) and assert every other pane unchanged.
            changed = [
                cls for cls in panes_after if panes_after[cls] != panes_before.get(cls)
            ]
            assert changed, (
                f"A restyle changed nothing: {panes_before} vs {panes_after}"
            )
            for cls in panes_after:
                if cls not in changed:
                    assert panes_after[cls] == panes_before[cls], (
                        f"pane {cls} bled: {panes_before[cls]} != {panes_after[cls]}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_fill_two_layers_keep_their_own_color_across_reload(
        self, browser, tmp_path
    ):
        """A persisted solid fill survives a page reload, per layer, with no decay.

        The write is persisted to localStorage and re-applied by the attach
        sweep on the next load. The failure this guards is not "the color came
        back wrong" (a wrong color is loud) but "the color silently decayed to
        the author default" — a reload can drop a layer back to its original
        fill while the row still reads the user's color, which is the quiet
        regression. Two layers are set to distinct solid fills, then the page
        reloads and every pane's path fill/stroke must be byte-identical to its
        pre-reload snapshot (and no pane may decay to the default blue).
        """

        def poly(name: str) -> folium.GeoJson:
            """One polygon layer with a numeric field so the fill row exists."""
            data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
            data["features"] = data["features"][:2]
            for i, feat in enumerate(data["features"]):
                feat["properties"] = {"value": i}
            return folium.GeoJson(json.dumps(data), name=name)

        first = poly("IsoLayerA")
        second = poly("IsoLayerB")
        with use_page(
            self._make_page, browser, tmp_path, first, second, slug="fill_reload_iso"
        ) as (page, errors):
            panel_ready(page)
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-item[data-layer-type=overlay]",
                state="attached",
                timeout=5000,
            )

            # Set A red, B blue through the real user write path.
            a_red = page.evaluate(
                _js("LayerControl/fill_two_layer_isolation"),
                {"targetLayer": "IsoLayerA", "color": "#ff0000"},
            )
            assert a_red.get("ok"), f"write A failed: {a_red}"
            b_blue = page.evaluate(
                _js("LayerControl/fill_two_layer_isolation"),
                {"targetLayer": "IsoLayerB", "color": "#0000ff"},
            )
            assert b_blue.get("ok"), f"write B failed: {b_blue}"
            panes_before = {
                p["cls"]: (p["fills"], p["strokes"]) for p in b_blue["panes"]
            }
            assert len(panes_before) >= 2, f"pane groups before reload: {b_blue}"

            # Reload; the attach sweep must re-apply the persisted fill.
            # Wait for the real signal — both colours present in the persisted
            # record — rather than sleeping on the 100ms write debounce. A fixed
            # sleep is either flaky (too short when the CI box is loaded) or
            # wasteful, and this test guards persistence: it must not guess.
            deadline = time.monotonic() + 5
            persisted = None
            while time.monotonic() < deadline:
                persisted = page.evaluate(_js("LayerControl/read_persisted_record"))
                stored = json.dumps(persisted) if persisted else ""
                if "#ff0000" in stored and "#0000ff" in stored:
                    break
                time.sleep(0.05)
            else:
                raise AssertionError(
                    f"fill never reached storage within 5s: {persisted}"
                )
            page.reload(wait_until="load")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            panel_ready(page)
            # No write path is driven here: this snapshot is read-only, so any
            # restored color came from the attach sweep, not from us.
            after = page.evaluate(_js("LayerControl/fill_reload_read"))
            assert after.get("ok"), f"read after reload failed: {after}"
            panes_after = {p["cls"]: (p["fills"], p["strokes"]) for p in after["panes"]}
            assert len(panes_after) >= 2, f"pane groups after reload: {after}"

            # Every pane must be byte-identical to its pre-reload snapshot.
            for cls in panes_before:
                assert cls in panes_after, (
                    f"pane {cls} missing after reload: {sorted(panes_after)}"
                )
                assert panes_after[cls] == panes_before[cls], (
                    f"pane {cls} changed across reload: {panes_before[cls]} != {panes_after[cls]}",
                )

            # The anti-decay guard: no pane may carry the default blue fill
            # unless it did so before the reload.
            for cls, (fills, _) in panes_after.items():
                assert (
                    "#3388ff" not in fills
                    or "#3388ff" in panes_before.get(cls, ([], []))[0]
                ), (f"pane {cls} decayed to default blue after reload: {fills}",)
            # The record itself must survive the reload: the colours above come
            # from localStorage, so a record that lost a layer would leave the
            # attach sweep nothing to re-apply even while the panes look right.
            stored_after = page.evaluate(_js("LayerControl/read_persisted_record"))
            assert stored_after, "the persisted record vanished across the reload"
            assert len(stored_after.get("layers") or {}) >= 2, (
                f"a layer dropped out of the persisted record: {stored_after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_sole_basemap_opacity_zero_shows_hatch(self, browser, tmp_path):
        """Dragging the sole basemap's opacity slider to 0 lights the no-basemap hatch.

        The judgement in `syncNoBasemap` (effective visibility = intent
        AND `opacity ?? 1 > 0`) is unit-tested; the trigger is the slider
        drag, which goes through `commitOpacityPct` → `applyProjection`.
        This is the end-to-end bridge — the failure mode is a correct
        judgement that is never called, so the hatch stays off after the
        user has visually emptied every basemap. Overlay opacity must not
        touch the hatch (unrelated to basemap visibility).
        """
        # Default folium map carries one OSM TileLayer; LayerControl picks
        # it up on attach as the sole base row. Hiding that one is enough
        # to leave the map with no visible basemap — which is exactly the
        # scenario where intent still says visible.
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        _expand_panel(m)
        # Expose the control instance for the probe (dev build keeps names).
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            m.get_root().render(),
            count=1,
        )
        assert n == 1, "LayerControl instantiation not found"
        html_path = tmp_path / "test_sole_basemap_opacity.html"
        html_path.write_text(html, encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/base_opacity_e2e"))
            assert result is not None
            assert result.get("error") is None, f"setup failed: {result}"

            # Sole base layer, untouched: no hatch.
            assert result["before"]["noBaseMap"] is False, result

            # Drag the sole basemap's opacity to 0: hatch on.
            assert result["atZero"]["noBaseMap"] is True, (
                f"opacity=0 on sole basemap did not light the hatch: {result}"
            )
            assert result["atZero"]["liOpacity"] == 0, result

            # Overlay opacity is unrelated to basemap visibility. Assert the
            # slider actually rendered (a bare featureGroup would not) so the
            # assertion is not vacuous.
            assert result["overlayZero"]["sliderFound"] is True, (
                f"overlay had no opacity slider — vacuous assertion: {result}"
            )
            assert result["overlayZero"]["liOpacity"] == 0, result
            assert result["overlayZero"]["noBaseMap"] is True, (
                f"overlay opacity must not clear the hatch: {result}"
            )

            # Back to 100: hatch off again.
            assert result["atHundred"]["noBaseMap"] is False, (
                f"opacity=1 did not clear the hatch: {result}"
            )
            assert result["atHundred"]["liOpacity"] == 1, result

    def test_style_fill_color_keeps_native_activation_keys(self, browser, tmp_path):
        """Space/Enter on a style panel's Fill Color picker stay native.

        <input type=color> is the other native activator living inside a row:
        Chromium fires its click from Space and Enter (measured on a bare
        page), but the step family it was classified with owned neither, so
        the row shortcut cancelled the key and toggled the layer checkbox
        behind the form instead of opening the picker. The native picker's
        visibility is unreliable headless — defaultPrevented plus the
        untouched checkbox is the evidence. Both color inputs are covered: a
        data layer's Fill Color row and the solid-color basemap's fill row.
        """
        geo = folium.GeoJson(_geo_mixed, name="Point layer")
        with use_page(
            self._make_page, browser, tmp_path, geo, slug="fill_color_keys"
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

            for layer in ("overlay", "color-map"):
                for key in ("Space", "Enter"):
                    arm = page.evaluate(_js("LayerControl/color_input_arm"), layer)
                    assert arm.get("error") is None, f"{layer}/{key}: {arm}"
                    assert arm["focusedTag"] == "input", (
                        f"{layer}/{key}: the Fill Color input did not take focus: {arm}"
                    )
                    assert arm["focusedType"] == "color", (
                        f"{layer}/{key}: focus is not a color picker: {arm}"
                    )
                    assert arm["colorInputs"] >= 1, (
                        f"{layer}/{key}: the style panel has no color input: {arm}"
                    )

                    page.keyboard.press(key)

                    read = page.evaluate(_js("LayerControl/color_input_read"))
                    presses = [
                        r for r in (read["records"] or []) if r["tag"] == "input"
                    ]
                    assert len(presses) == 1, (
                        f"{layer}/{key}: expected one input keydown, "
                        f"got {read['records']}"
                    )
                    assert presses[0]["prevented"] is False, (
                        f"{layer}/{key}: foliplus cancelled the color picker's "
                        f"native activation key: {read['records']}"
                    )
                    assert read["styleOpen"] is True, (
                        f"{layer}/{key}: the style panel closed on the picker "
                        f"key: {read}"
                    )
                    assert read["checkboxAfter"] == arm["checkboxBefore"], (
                        f"{layer}/{key}: the row shortcut flipped the layer "
                        f"checkbox: before={arm['checkboxBefore']} "
                        f"after={read['checkboxAfter']}"
                    )
            assert not errors, f"JS errors: {errors}"

    def test_late_layer_opacity_survives_reload(self, browser, tmp_path):
        """A lazily-registered layer keeps its stored opacity across a reload.

        HeatmapControl registers its canvas in its own constructor, which runs
        after the LayerControl IIFE has already attached the panel. On the
        first attach the heatmap's id is therefore unresolvable, and the sweep
        used to read that as "the layer is gone for good": it dropped the
        stored opacity from memory and wrote the deletion back, so every
        refresh reset the user's opacity to the author default. Nothing in the
        page says the layer is gone -- only a delete does -- so a reload must
        not touch the record at all.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08, {"val": 26.08})))
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html = m.get_root().render()
        match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
        assert match, "map variable not found in rendered HTML"
        # The visit under test is the reload: seed the record the previous
        # visit would have written (heatmap at 35%), then re-read it. The
        # heatmap id is the stable component id, not a per-map suffix.
        seed = {
            "order": None,
            "foldedRoles": [],
            "renamedNames": {},
            "annotations": {},
            "layers": {
                "foliplus_heatmap": {
                    "opacity": 0.35,
                    "overrides": ["opacity"],
                }
            },
        }

        html_path = tmp_path / "test_late_layer_opacity_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.add_init_script(
                _js("LayerControl/seed_layer_state")
                .replace("__KEY__", match.group(1))
                .replace("__SEED__", json.dumps(json.dumps(seed)))
            )
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            # The value the previous visit wrote must still be in storage.
            after_attach = page.evaluate(_js("LayerControl/read_opacity_state"))
            assert after_attach.get("id"), f"heatmap row missing: {after_attach}"
            assert after_attach["stored"] == 0.35, (
                f"attach dropped the stored opacity: {after_attach}"
            )
            assert after_attach["overrides"] == ["opacity"], (
                f"attach dropped the stored provenance: {after_attach}"
            )
            assert after_attach["canvasRegistered"] is True, (
                f"heatmap canvas never registered: {after_attach}"
            )
            assert after_attach["canvasOpacity"] == "0.35", (
                f"attach reset the canvas to the author default: {after_attach}"
            )

            # And the user can still move the slider, then survive a reload.
            set_result = page.evaluate(_js("LayerControl/set_heatmap_opacity"))
            assert set_result.get("id"), f"could not set opacity: {set_result}"
            assert set_result["value"] == 35, f"slider did not take 35: {set_result}"
            page.wait_for_timeout(300)

            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            page.wait_for_timeout(200)

            after_reload = page.evaluate(_js("LayerControl/read_opacity_state"))
            assert after_reload.get("id"), f"heatmap row missing: {after_reload}"
            assert after_reload["stored"] == 0.35, (
                f"reload reverted the user's opacity to the author default: "
                f"{after_reload}"
            )
            assert after_reload["overrides"] == ["opacity"], (
                f"reload dropped the stored provenance: {after_reload}"
            )
            assert after_reload["canvasOpacity"] == "0.35", (
                f"reload painted the canvas at the author default: {after_reload}"
            )

    def test_vector_border_writes_the_stroke_and_survives_reload(
        self, browser, tmp_path
    ):
        """A border change rewrites the vector's own stroke and outlives reload.

        Border is not part of the executor's visible / opacity / zoomRange
        family — the panel writes it with a direct ``setStyle`` — so nothing in
        the projection replay would restore it. Without its own replay the row
        could show the user's color while the map kept painting the author's
        stroke, which is the one failure mode this asserts against.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        # The polygon rides inside a named, visible FeatureGroup: that is how a
        # data layer earns a panel row (a bare vector has no control of its own).
        fg = folium.FeatureGroup(name="Test Region", overlay=True, show=True)
        folium.Polygon(
            leaflet_path("LayerControl", "polygon_hangzhou_triangle"),
            color="#0000ff",
            weight=2,
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_vector_border_reload.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert before.get("row"), f"layer row not found: {before}"
            assert before["strokes"], f"no stroked path on the map: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] == "#0000ff", (
                    f"author stroke never reached the map: {before}"
                )
                assert stroke["strokeWidth"] == "2", (
                    f"author width never reached the map: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Test Region", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] == 1, f"expected one border row: {row}"
            assert row["color"] == "#ff0000", f"swatch did not take: {row}"
            assert row["weight"] == "6", f"width field did not take: {row}"
            assert row["strokes"], f"the stroke never reached the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"the color change did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"the width change did not reach the SVG: {row}"
                )

            # Let the debounce commit, then reload — the stored record is the
            # only thing that survives.
            page.wait_for_timeout(300)
            page.reload(wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            after = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Test Region"]
            )
            assert after.get("panel"), f"the style panel did not reopen: {after}"
            assert after["color"] == "#ff0000", (
                f"reload reverted the border color: {after}"
            )
            assert after["weight"] == "6", f"reload reverted the border width: {after}"
            assert after["strokes"], f"no stroked path after reload: {after}"
            for stroke in after["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"reload dropped the border stroke\n{after}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"reload dropped the border width\n{after}"
                )

            key = next(k for k in after["storage"] if "layer_state" in k)
            record = json.loads(after["storage"][key])
            # The record is keyed by folium's generated id, not the label the
            # row displays.
            entry = record["layers"].get(after["id"])
            assert entry, f"border state never persisted: {record}"
            assert entry["borderColor"] == "#ff0000", f"stored the wrong color: {entry}"
            assert entry["borderWeight"] == 6, f"stored the wrong width: {entry}"

    def test_heatmap_keeps_its_own_border_row_only(self, browser, tmp_path):
        """The delegated drawer owns the heatmap's border, so one row total.

        The generic border row must never render next to the drawer's own
        border row in the same panel — the two write through different paths
        and would fight over the same visual axis.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        # The heatmap only earns a panel row once it has a point layer to
        # aggregate, so give it one — its id is the stable component id.
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08, {"val": 26.08})))
        ).add_to(fg)
        fg.add_to(m)
        # The border row label is read in English, so pin the page locale.
        LayerControl(locale="en").add_to(m)
        HeatmapControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_heatmap.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            heatmap_ready(page, timeout=15000)
            panel_ready(page)
            page.wait_for_timeout(200)

            panel = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["foliplus_heatmap"]
            )
            assert panel.get("panel"), f"the heatmap panel did not open: {panel}"
            # The drawer builds its own border row with the shared FORM_ROW
            # chrome but not the vector row's class.
            assert panel["borderRows"] == 0, (
                f"the vector border row rendered for a delegated layer: {panel}"
            )
            assert panel["labels"].count("Border") == 1, (
                f"expected exactly one border row, got: {panel['labels']}"
            )

    def test_border_original_roundtrip_restores_computed_style(self, browser, tmp_path):
        """A solid → ORIGINAL round trip repaints the author's stroke.

        The restore path is the point, not the switch over: after the user
        writes a colour and width in solid mode and returns to ORIGINAL, the
        panel must show the author's colour (read-only) and the map must paint
        it. Asserted on getComputedStyle — what the browser actually paints —
        never on DOM attributes or source strings.

        A width the user chose rides both modes, so it stays after the return
        (the weight slot stays editable in ORIGINAL). The author's colour must
        come back even though the user's colour is still stored for the next
        solid visit.

        The read-only guard is the negative case: if ORIGINAL ever lets the
        user edit the colour again (colour intent wins over author stroke),
        the swatch stops being disabled and this test fails.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        # A numeric property is what earns the border mode select (original /
        # solid / value); without it the row renders a bare solid swatch and
        # there is no mode to switch back from. The style_function carries the
        # authored stroke so ORIGINAL has an author colour to restore. A plain
        # GeoJson data layer is the proven _ramp_layer() pattern that also
        # produces a panel row.
        border_data = copy.deepcopy(load_geojson("common", "polygons_fuzhou_3offset"))
        folium.GeoJson(
            json.dumps(border_data),
            style_function=lambda _f: {"color": "#0000ff", "weight": 2},
            name="Polygon data",
        ).add_to(m)
        LayerControl(locale="en").add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_original_roundtrip.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            # Author baseline: original mode, read-only swatch showing the
            # author's colour, map painting it.
            baseline = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data"],
            )
            assert baseline.get("row"), f"layer row not found: {baseline}"
            assert baseline["mode"] == "original", baseline
            assert baseline["colorInput"]["readOnly"] is True, baseline
            assert baseline["colorInput"]["disabled"] is True, baseline
            for stroke in baseline["strokes"]:
                assert stroke["stroke"] == "rgb(0, 0, 255)", (
                    f"author stroke not painted at baseline: {baseline}"
                )
                assert stroke["strokeWidth"] == "2px", (
                    f"author width not painted at baseline: {baseline}"
                )

            # Solid: write a user colour and width.
            solid = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data", "solid", "#ff0000", 6],
            )
            assert solid["mode"] == "solid", solid
            assert solid["colorInput"]["readOnly"] is False, solid
            for stroke in solid["strokes"]:
                assert stroke["stroke"] == "rgb(255, 0, 0)", (
                    f"solid colour did not reach the map: {solid}"
                )
                assert stroke["strokeWidth"] == "6px", (
                    f"solid width did not reach the map: {solid}"
                )

            # Let the solid write's debounce land before the next call reads
            # storage (the record is written 100ms after the last input event).
            page.wait_for_timeout(300)

            # Back to ORIGINAL: the author's colour returns, the user's width
            # stays, the swatch is read-only again.
            restored = page.evaluate(
                _js("LayerControl/border_original_roundtrip"),
                ["Polygon data", "original"],
            )
            assert restored["mode"] == "original", restored
            assert restored["colorInput"]["readOnly"] is True, restored
            assert restored["colorInput"]["disabled"] is True, restored

            # Let the restored mode write's debounce land, then read the
            # record fresh — the storage snapshot inside the restored call was
            # taken before its own 100ms debounce had fired. The repaint from
            # the mode change also lands on the frame clock (throttleRaf), so
            # assert the computed style only after this wait let the frame fire.
            page.wait_for_timeout(300)
            final = page.evaluate(
                _js("LayerControl/border_original_roundtrip"), ["Polygon data"]
            )

            # The author's colour must be back and the user's width must ride
            # both modes.
            for stroke in final["strokes"]:
                assert stroke["stroke"] == "rgb(0, 0, 255)", (
                    f"author stroke not restored after round trip: {final}"
                )
                assert stroke["strokeWidth"] == "6px", (
                    f"user width lost after round trip: {final}"
                )

            # The stored record keeps the user's colour for the next solid
            # visit — ORIGINAL does not erase it.
            key = next(k for k in final["storage"] if "layer_state" in k)
            record = json.loads(final["storage"][key])
            entry = record["layers"].get(final["id"])
            assert entry, f"border state never persisted: {record}"
            assert entry["borderStyleMode"] == "original", (
                f"stored the wrong mode: {entry}"
            )
            assert entry["borderColor"] == "#ff0000", (
                f"the user's colour was erased on return: {entry}"
            )
            assert entry["borderWeight"] == 6, (
                f"the user's width was erased on return: {entry}"
            )

    def test_border_swatch_shows_a_named_color_as_hex(self, browser, tmp_path):
        """The swatch agrees with the map for a named authored color.

        folium's quickstart styles its faces with the named color ``gray``.
        The GeoJSON read used to return the layer's own options instead of
        its first feature's, which put a stroke the map was not painting into
        the panel — the same "the swatch disagrees with the map" defect,
        reached through the color form instead of through the layer tree.

        The face paints ``stroke="gray"``; the swatch must therefore read
        ``#808080``, the hex for that same color, not black and not
        Leaflet's default. The neighboring line keeps its own stroke, which
        pins the assertion to the color form rather than to anything the
        map does with it.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        fg = folium.FeatureGroup(name="Region", overlay=True, show=True)
        folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "face_polygon_line_hangzhou")),
            style_function=lambda f: (
                {"color": "gray", "weight": 1.5}
                if f["properties"]["kind"] == "face"
                else {"color": "#e74c3c", "weight": 6}
            ),
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_border_named_color.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            row = page.evaluate(_js("LayerControl/border_set_and_read"), ["Region"])
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["borderRows"] == 1, f"expected one border row: {row}"
            # gray as hex — not black, and not Leaflet's default.
            assert row["color"] == "#808080", (
                f"the swatch did not show the authored name as hex: {row}"
            )
            assert row["weight"] == "1.5", f"the width field did not take: {row}"

            strokes = {s["stroke"] for s in row["strokes"]}
            assert "gray" in strokes, (
                f"the face stopped painting the authored name\n{row['strokes']}"
            )
            assert "#e74c3c" in strokes, (
                f"the neighbouring line lost its own stroke\n{row['strokes']}"
            )

    def test_circlemarker_stroke_false_border_write_is_visible_and_resettable(
        self, browser, tmp_path
    ):
        """A stroke:false CircleMarker must show a user border, and Reset must hide it again.

        quickstart Facility Points authors ``style_kwds={"stroke": False}``
        (geopandas explore → folium CircleMarker). Writing color/weight alone
        leaves Path painting ``stroke=none`` — the panel change would be a
        silent no-op. The write must turn stroke on; Reset must put the
        author's ``stroke: False`` back so the border disappears again.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        fg = folium.FeatureGroup(name="Facility Points", overlay=True, show=True)
        folium.CircleMarker(
            [30.0, 120.0],
            radius=5,
            color="#3388ff",
            weight=2,
            fill=True,
            fill_opacity=0.8,
            stroke=False,
        ).add_to(fg)
        fg.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_circlemarker_stroke_false_border.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(
                _js("LayerControl/border_set_and_read"), ["Facility Points"]
            )
            assert before.get("panel"), f"the style panel did not open: {before}"
            assert before["borderRows"] == 1, f"expected one border row: {before}"
            for stroke in before["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"author stroke:false should paint stroke=none: {before}"
                )

            row = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", "#ff0000", 6],
            )
            assert row.get("panel"), f"the style panel did not open: {row}"
            assert row["strokes"], f"no path on the map: {row}"
            for stroke in row["strokes"]:
                assert stroke["stroke"] == "#ff0000", (
                    f"border color did not reach the SVG: {row}"
                )
                assert stroke["strokeWidth"] == "6", (
                    f"border width did not reach the SVG: {row}"
                )

            reset = page.evaluate(
                _js("LayerControl/border_set_and_read"),
                ["Facility Points", None, None, True],
            )
            assert reset.get("panel"), f"the style panel did not reopen: {reset}"
            assert reset["strokes"], f"no path after reset: {reset}"
            for stroke in reset["strokes"]:
                assert stroke["stroke"] in (None, "none"), (
                    f"reset must restore the author's stroke:false\n{reset}"
                )

    def test_circlemarker_size_row_writes_radius_and_reset_restores_authored(
        self, browser, tmp_path
    ):
        """The Size row writes every pixel-radius leaf; Reset restores the author's.

        Two CircleMarker radii (5 and 9) share one FeatureGroup. Typing 30
        must reach both leaves -- getRadius() and what the SVG is painting --
        and persist as layers[id].size == 30. Reset must bring back 5 and 9, not
        the user's last choice of 30: the authored radius is captured on the
        layer's first write, so a re-read would restore the user's own number
        and every keystroke would compound.
        A Polygon on the same map has no pixel-radius leaf, so its style
        panel must not render the row at all.
        """
        m = folium.Map(location=[30.0, 120.0], zoom_start=6, tiles=None)
        fg = folium.FeatureGroup(name="Facility Points", overlay=True, show=True)
        folium.CircleMarker(
            [30.0, 120.0],
            radius=5,
            color="#3388ff",
            weight=2,
            fill=True,
            fill_opacity=0.8,
        ).add_to(fg)
        folium.CircleMarker(
            [30.02, 120.02],
            radius=9,
            color="#e74c3c",
            weight=2,
            fill=True,
            fill_opacity=0.8,
        ).add_to(fg)
        fg.add_to(m)
        region = folium.FeatureGroup(name="Test Region", overlay=True, show=True)
        folium.Polygon(
            leaflet_path("LayerControl", "polygon_hangzhou_square"),
            color="#3388ff",
            weight=2,
            fill=True,
            fill_opacity=0.2,
        ).add_to(region)
        region.add_to(m)
        LayerControl().add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_circlemarker_size_row.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)

            before = page.evaluate(_js("LayerControl/size_row"), ["Facility Points"])
            assert before.get("panel"), f"the style panel did not open: {before}"
            assert before.get("sizeRow"), f"the Size row did not render: {before}"
            assert before["sizeRows"] == 1, f"expected exactly one Size row: {before}"
            assert len(before["leaves"]) == 2, (
                f"expected both authored markers: {before}"
            )
            assert {leaf["radius"] for leaf in before["leaves"]} == {5, 9}, (
                f"the authored radii were already wrong before any write: {before}"
            )
            assert before["storage"] is None, (
                f"an untouched visit stored a size: {before}"
            )
            layout = before.get("sizeLayout")
            assert layout, f"the Size field was not measurable: {before}"
            assert layout["textAlign"] == "center", (
                f"the Size value must be horizontally centered: {layout}"
            )
            assert layout["rightGap"] <= 1, (
                f"the Size box must sit at the right edge of its column: {layout}"
            )

            after = page.evaluate(_js("LayerControl/size_row"), ["Facility Points", 30])
            assert after.get("panel"), f"the style panel did not reopen: {after}"
            assert after["sizeRows"] == 1, f"the Size row disappeared: {after}"
            assert after["sizeInput"] == "30", (
                f"the field did not keep the typed value: {after}"
            )
            assert len(after["leaves"]) == 2, f"no leaves to write to: {after}"
            for leaf in after["leaves"]:
                assert leaf["radius"] == 30, (
                    f"the radius did not reach the leaf: {after}"
                )
                assert leaf["svgRadius"] == 30, (
                    f"the SVG did not repaint the radius: {leaf}"
                )
            assert after["storage"] is not None, f"no persisted entry: {after}"
            assert after["storage"].get("size") == 30, (
                f"the persisted entry did not carry the size: {after}"
            )
            assert "size" in (after["storage"].get("overrides") or []), (
                f"the persisted size carried no provenance marker: {after}"
            )

            reset = page.evaluate(
                _js("LayerControl/size_row"), ["Facility Points", None, True]
            )
            assert reset.get("panel"), f"the style panel did not reopen: {reset}"
            assert len(reset["leaves"]) == 2, f"no leaves after reset: {reset}"
            assert {leaf["radius"] for leaf in reset["leaves"]} == {5, 9}, (
                f"reset must restore the author's radii, not the last choice: {reset}"
            )
            assert {leaf["svgRadius"] for leaf in reset["leaves"]} == {5, 9}, (
                f"the SVG did not repaint the authored radii: {reset}"
            )
            assert reset["storage"] is None or "size" not in reset["storage"], (
                f"reset did not drop the persisted size: {reset}"
            )

            polygon = page.evaluate(_js("LayerControl/size_row"), ["Test Region"])
            assert polygon.get("panel"), (
                f"the polygon's style panel did not open: {polygon}"
            )
            assert polygon["sizeRows"] == 0, (
                f"the Size row must not render for a polygon: {polygon}"
            )
            assert polygon["storage"] is None or "size" not in polygon["storage"], (
                f"reading the polygon stored a size: {polygon}"
            )

    def test_unregister_keeps_stored_opacity_delete_drops_it(self, browser, tmp_path):
        """unregisterLayer never erases a value; only an explicit delete does.

        The heatmap's empty-data frame reaches unregisterLayer the same way
        this probe does, so the teardown that drops a stored opacity would
        have fired on a data change -- the user would see "I only switched the
        data source, why did my opacity reset?" Deleting the layer is the one
        action that knows the id is gone for good.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Overlay A", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_unregister_keeps_opacity.html"
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
            page.wait_for_timeout(200)

            result = page.evaluate(_js("LayerControl/canvas_unregister_keeps_state"))
            assert result.get("afterSet"), f"probe did not reach the write: {result}"
            assert result["afterSet"] == {
                "opacity": 0.35,
                "overrides": ["opacity"],
            }, f"slider write did not persist: {result}"

            # The layer is gone from the map and the panel...
            assert result["registeredAfterUnregister"] is False, (
                f"unregister did not remove the layer: {result}"
            )
            # ...but the stored opacity is untouched, and the registry did not
            # keep a row for it either.
            assert result["afterUnregister"] == {
                "opacity": 0.35,
                "overrides": ["opacity"],
            }, f"unregister erased a value it had no right to drop: {result}"

            # The explicit path is what drops it -- and only it.
            assert result["deleteError"] is None, (
                f"deleteLayer raised: {result['deleteError']}"
            )
            assert result["deleteReturn"] is True, f"deleteLayer failed: {result}"
            assert result["afterDelete"] is None, (
                f"delete did not drop the stored value: {result}"
            )
            assert result["registeredAfterDelete"] is False, (
                f"delete left the layer registered: {result}"
            )

    def test_color_layer_coexists_with_tiles(self, browser, tmp_path):
        """Color and tile basemaps coexist. Checking the color basemap's
        checkbox activates its own pane (the retired
        `foliplus-layer-tile-hidden` contract is gone — tiles stay in the DOM
        and remain fetchable)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False).add_to(
            m
        )

        html_path = tmp_path / "test_color_tiles.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Check the color basemap's checkbox — the only legitimate path
            # to show the color layer. Clicking the row body no longer does
            # it (#494).
            toggle = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert toggle is not None and toggle["ok"] is True, toggle
            page.wait_for_timeout(500)

            result = page.evaluate(_js("LayerControl/read_color_tile_state"))
            assert result is not None
            # The retired tile-hidden contract must not be applied.
            assert result["tileHidden"] is False, (
                "color layer must not stamp foliplus-layer-tile-hidden"
            )
            assert result["colorBg"] is True, "color item should have active class"

    def test_color_basemap_checkbox_toggles_visibility(self, browser, tmp_path):
        """Checking the color basemap's checkbox must toggle its visibility.

        The row's checkbox column holds a real ``<input type="checkbox">``
        (like every other basemap row).  Checking it paints the container
        background (``.foliplus-active`` + ``--color-layer-bg``); unchecking it clears
        both.  Without the fix the row has only a color picker and no
        checkbox, so the toggle cannot happen.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html_path = tmp_path / "test_color_checkbox.html"
        html_path.write_text(m.get_root().render(), encoding="utf-8")

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl", state="attached", timeout=10000
            )
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Initial state: checkbox exists and is unchecked.
            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state is not None
            assert state["hasCheckbox"] is True, (
                "color basemap row must have a real checkbox"
            )
            assert state["checked"] is False, "color basemap starts unchecked"
            assert state["active"] is False, "container starts without .foliplus-active"

            # Check the checkbox → container background takes effect.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is True

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is True
            assert state["active"] is True, "checking must mark the color row active"
            assert state["colorVisible"] is True, (
                "checking must show the color pane face"
            )

            # Uncheck → container background cleared.
            result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
            assert result is not None and result["ok"] is True, result
            assert result["checked"] is False

            state = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state["checked"] is False
            assert state["active"] is False, (
                "unchecking must clear the color row active class"
            )
            assert state["colorVisible"] is False, (
                "unchecking must hide the color pane face"
            )

    def test_color_basemap_zorder_stack(self, browser, tmp_path):
        """Color basemap participates in the z-order ladder like tile basemaps.

        Row order = visual stack order. When the color row is above a tile
        basemap, its pane has a higher z-index and covers the tiles; when
        below, the tiles cover it. Reordering flips the stack live.
        """
        tile = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        with use_page(self._make_page, browser, tmp_path, tile) as (page, _):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            page.wait_for_timeout(500)

            # Read initial state.
            state0 = page.evaluate(_js("LayerControl/read_color_checkbox_state"))
            assert state0 is not None

            # Ensure the color basemap is shown (check the checkbox if unchecked).
            if not state0.get("checked"):
                result = page.evaluate(_js("LayerControl/toggle_color_checkbox"))
                assert result["ok"] is True
            else:
                # Already checked — verify the pane exists.
                result = {"ok": True, "checked": True}

            # Initial state: color pane exists and tile pane exists.
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneFound"] is True, "color pane must exist after show"
            assert state["tilePaneFound"] is True
            assert state["colorPaneZ"] is not None
            assert state["tilePaneZ"] is not None
            initialColorZ = state["colorPaneZ"]

            # Case 1: move color above tile → color pane z increases.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > initialColorZ, (
                f"color above: z should increase, {initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 2: move color below tile → color pane z drops below the tile pane.
            page.evaluate(_js("LayerControl/set_probe"), {"action": "below"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] < state["tilePaneZ"], (
                f"color below: color pane z must be below tile pane z, "
                f"color={state['colorPaneZ']} tile={state['tilePaneZ']}"
            )
            assert state["colorPaneZ"] == initialColorZ, (
                f"color below: z should return to initial, "
                f"{initialColorZ} -> {state['colorPaneZ']}"
            )

            # Case 3: reorder back above → z-indexes flip again (live).
            page.evaluate(_js("LayerControl/set_probe"), {"action": "above"})
            state = page.evaluate(_js("LayerControl/color_zorder_stack"))
            assert state["ok"] is True
            assert state["colorPaneZ"] > state["tilePaneZ"], (
                "reorder back above: color z must increase again"
            )

    def test_setvisible_out_of_zoom_range_fires_intent_not_change(
        self, browser, tmp_path
    ):
        """A setVisible(true) that policy gates fires LAYER_INTENT_CHANGE only.

        User-reported boundary: a layer with a stored zoom range that
        excludes the current map zoom is policy-hidden. Flipping the
        user's checkbox changes the stored intent but not the effective
        map membership — the zoom-range policy still blocks it.

        `LAYER_CHANGE` rides the effective flip (`intent && policy`), so
        a policy-gated flip fires nothing on that channel. External
        controls that mirror the user's checkbox state in their own UI
        (a cycling slider, a mode badge) would never hear the movement
        and would desync from the panel. `LAYER_INTENT_CHANGE` is the
        separate channel for that user-only signal.

        This is the exact boundary the executor's effective-only emit
        could not see: the LAYER_CHANGE emission is gated on
        `wrote === true`, and a policy-gated flip writes nothing to
        the map.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            panel_ready(page)
            result = page.evaluate(
                _js("LayerControl/intent_change_gated_by_zoom_range"),
                load_geojson("common", "point_1193_2608"),
            )
            assert result is not None, result
            assert result.get("error") is None, f"setup failed: {result}"
            assert not errors, f"JS errors: {errors}"

            # Precondition: the map is at zoom 12, the stored range is
            # [15, 18], and setVisible(false) recorded a false intent
            # while the layer was already policy-hidden.
            assert result["zoom"] == 12, result
            assert result["range"] == [15, 18], result
            assert result["beforeShow"]["intentVisible"] is False, result
            assert result["beforeShow"]["onMap"] is False, result
            assert result["ok"] is True, result

            # After setVisible(true): the stored intent flipped, the
            # checkbox the panel shows is checked, but the layer never
            # entered the map — the zoom-range policy still gates it.
            assert result["afterShow"]["intentVisible"] is True, result
            assert result["afterShow"]["onMap"] is False, result

            # Only one LAYER_INTENT_CHANGE for this layer, carrying the
            # fresh intent the user just recorded.
            assert result["intentCount"] == 1, result
            assert result["intentPayloads"] == [
                {
                    "id": "__test_intent_gated__",
                    "kind": "vector",
                    "intent": {"visible": True},
                }
            ], result

            # No LAYER_CHANGE on the effective channel — the layer
            # stayed off the map throughout the setVisible(true) call.
            assert result["changeCount"] == 0, result

    def test_native_gate_range_slider_arrowdown(self, browser, tmp_path):
        """ArrowDown on a focused zoom-range thumb moves the thumb, never the row cursor.

        Row 1 of the input-ownership table, exercised through Chromium's real
        keyboard pipeline: the key is pressed with ``page.keyboard`` after a
        real focus, and a capture listener reports the browser's final
        ``defaultPrevented``. Both halves of the gate are measured — the thumb
        actually stepped, and the row cursor did not follow the keypress.
        Synthetic ``dispatchEvent`` cannot prove either.
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

    def test_style_panel_scheme_dropdown_clears_the_panel(self, browser, tmp_path):
        """The style panel's scheme dropdown is fully visible and hit-testable.

        The panel is a row panel — fixed-position, pinned under its layer row —
        while the picker's dropdown is portaled to <body>. Both float, so the
        dropdown must outrank the expanded control (its bar/section are lifted
        to floating +1/+9): without that, the panel painted over the open list
        and every item was unclickable, which is what the fill row shipped
        with. The card also has to stay inside the viewport rather than being
        clipped by the layer list's scroll box — the reason the panel is fixed
        in the first place.

        Measured from live rects, no magic numbers: the assert is "the point at
        the widget's center resolves to the widget itself", the same contract
        the row-overlay probes use.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="style_scheme_dd"
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

            result = page.evaluate(_js("LayerControl/style_scheme_dropdown"))
            assert result["ok"], f"scheme row did not open: {result}"
            assert result["panelInViewport"], (
                "the fixed row panel must stay inside the viewport, not be clipped "
                f"by the layer list's scroll box: {result['panelRect']}"
            )
            assert result["triggerInViewport"], (
                f"the scheme trigger is not reachable: {result['triggerRect']}"
            )
            assert result["triggerHitInsidePanel"], (
                "the scheme trigger must be the topmost element at its center"
            )
            assert result["dropdownRect"], "the scheme dropdown did not mount"
            assert result["dropdownInViewport"], (
                f"the dropdown overflows the viewport: {result['dropdownRect']}"
            )
            assert result["dropdownHitInsideDropdown"], (
                "the open dropdown is painted under the style panel: the point at "
                "its center hit "
                f"{result['dropdownHitClass']} (z={result['dropdownZ']})"
            )
            assert not errors, f"JS errors: {errors}"

    # ── scheme picker portal: the list is part of the drawer ────────────
    #
    # The picker portals its color list to <body> (or the fullscreen element)
    # so it can paint above the drawer that owns the trigger. A press on that
    # list therefore reaches the document-level dismiss listeners with a target
    # outside every panel class, while still being part of the drawer's
    # interaction: the drawer used to close at mousedown, before the click could
    # select a color. element.click() dispatches no mousedown, so these
    # regressions need Playwright's real mouse press.

    def test_style_scheme_portal_pick_keeps_the_drawer(self, browser, tmp_path):
        """A real press on the portalled color list keeps the drawer open.

        The list lives on <body>, so the press has to be classified as part of
        the drawer's overlay rather than by the drawer's own subtree. The press
        is what commits the color: the drawer must survive it, the picker must
        close behind it, and the hidden select, the trigger title and the color
        bar must all show the chosen scheme — then the value has to survive a
        close and reopen, which rebuilds the drawer from the layer's own ramp
        state. A pick that tears the drawer down would drop the click entirely
        and leave the old scheme behind; "the drawer is still there" alone does
        not prove the write landed.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_pick",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], f"the ramp mode did not settle: {ready}"
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )

            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"
            assert rows["dropdownParentTag"] == "BODY", (
                "the picker must portal its list to <body>, got "
                f"{rows['dropdownParentTag']}"
            )

            before = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert before["drawerVisible"] and before["dropdownPresent"], before
            target = rows["targetName"]
            assert target and target != before["triggerTitle"], (
                f"the probe picked the scheme already shown ({target}): {rows}"
            )

            page.mouse.click(rows["targetX"], rows["targetY"])
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], (
                f"the color press dismissed the drawer: {state}"
            )
            assert state["hiddenValue"] == target, (
                f"the pick did not commit {target}: {state}"
            )
            assert state["triggerTitle"] == target, (
                f"the trigger still shows {state['triggerTitle']}, expected {target}"
            )
            assert state["barBlockColor"] != before["barBlockColor"], (
                "the color bar was not repainted for the new scheme: "
                f"{before['barBlockColor']} -> {state['barBlockColor']}"
            )
            assert not state["dropdownPresent"], (
                f"the list must close after a pick: {state}"
            )

            # Close and reopen: the drawer renders from the layer's committed
            # ramp state, so only a write that really landed comes back.
            page.click(
                ".foliplus-layer-style-panel .foliplus-panel-header .foliplus-close-btn"
            )
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="detached", timeout=3000
            )
            reopened = page.evaluate(_js("LayerControl/open_style_panel"))
            assert reopened["ok"], f"the drawer did not reopen: {reopened}"
            page.wait_for_selector(
                ".foliplus-layer-style-panel", state="visible", timeout=5000
            )
            settled = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert settled["triggerTitle"] == target, (
                f"the reopened drawer shows {settled['triggerTitle']}, expected "
                f"{target} — the pick did not persist"
            )
            assert settled["hiddenValue"] == target, settled
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_survives_a_scroll(self, browser, tmp_path):
        """Scrolling while the list is open re-pins it and keeps the drawer.

        The drawer scrolls its own content (the card is capped and pinned), and
        the portalled list has to follow the trigger it belongs to. A scroll is
        not a dismissal: both surfaces stay on screen.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_scroll",
        ) as (page, errors):
            self._open_style_ramp(page)
            # The label section makes the card tall enough to scroll inside
            # itself. Expand it before the list opens: the toggle re-renders the
            # drawer, which would rebuild the ramp mode and drop an already-open
            # picker.
            tall = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert tall["ok"], tall
            assert tall["content"]["scrollHeight"] > tall["content"]["clientHeight"], (
                f"the drawer has nothing to scroll: {tall['content']}"
            )

            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )
            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"

            # The live box the wheel must target, measured with the list open.
            before = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert before["ok"], before
            content = before["content"]
            rect = content["rect"]
            # The open list floats over the card, so the wheel has to land on a
            # card point the list does not cover — otherwise the list eats it
            # and the drawer never scrolls.
            dropdown = rows["dropdownRect"]
            corners = [
                (rect["left"] + 24, rect["top"] + 24),
                (rect["right"] - 24, rect["top"] + 24),
                (rect["left"] + 24, rect["bottom"] - 24),
                (rect["right"] - 24, rect["bottom"] - 24),
            ]
            free = [
                (x, y)
                for x, y in corners
                if not (
                    dropdown["left"] <= x <= dropdown["right"]
                    and dropdown["top"] <= y <= dropdown["bottom"]
                )
            ]
            assert free, (
                "the open list covers the whole card, no wheel target left: "
                f"card={rect} list={dropdown}"
            )
            x, y = free[0]
            page.mouse.move(x, y)
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(300)

            after = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert after["content"]["scrollTop"] > 0, (
                f"the wheel over the card did not scroll it: {content}"
            )
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], f"scrolling dismissed the drawer: {state}"
            assert state["dropdownPresent"], (
                f"scrolling must re-pin the portalled list, not close it: {state}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_outside_press_still_dismisses(self, browser, tmp_path):
        """A press outside the drawer and its portalled list still dismisses it.

        Portal awareness must not turn the dismiss into a no-op: the map is
        still outside the overlay, and a press there closes the drawer.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_outside",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )
            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], f"scheme list did not open: {rows}"

            viewport = ready["viewport"]
            page.mouse.click(60, viewport["height"] - 80)

            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert not state["drawerVisible"], (
                f"a press on the map must dismiss the drawer: {state}"
            )
            assert not state["dropdownPresent"], state
            assert not errors, f"JS errors: {errors}"

    def test_style_scheme_portal_rehosts_under_fullscreen(self, browser, tmp_path):
        """Fullscreen re-hosts the portalled list; a pick there keeps the drawer.

        The picker moves its list into document.fullscreenElement when it
        exists, so the same press has to stay inside the overlay after the
        re-host. Headless browsers may refuse the Fullscreen API without a user
        gesture — that leg reports why it is skipped instead of failing, and the
        re-host itself is pinned by the jsdom suite.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_scheme_portal_fullscreen",
        ) as (page, errors):
            self._open_style_ramp(page)
            ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
            assert ready["ok"], ready
            # A real press opens the list and supplies the user activation
            # requestFullscreen needs.
            page.mouse.click(ready["triggerX"], ready["triggerY"])
            page.wait_for_selector(
                ".foliplus-scheme-picker-portal", state="attached", timeout=3000
            )

            full = page.evaluate(_js("LayerControl/style_scheme_portal_fullscreen"))
            if not full.get("ok"):
                pytest.skip(
                    f"headless browser refused fullscreen: {full.get('reason')}"
                )
            assert full["fullscreen"], full
            assert full["rehosted"], (
                f"the portalled list did not move into the fullscreen element: {full}"
            )

            rows = page.evaluate(_js("LayerControl/style_scheme_portal_rows"))
            assert rows["ok"], rows
            page.mouse.click(rows["targetX"], rows["targetY"])
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], (
                f"a color press under fullscreen dismissed the drawer: {state}"
            )
            assert not errors, f"JS errors: {errors}"
            page.evaluate(_js("LayerControl/exit_fullscreen"))

    @pytest.mark.parametrize("how", ["outside", "escape"])
    def test_style_mode_dropdown_outside_press_dismisses(self, browser, tmp_path, how):
        """Both mode dropdowns (fill and border) close on a dismissal.

        The mode row uses the shared dropdown bridged to a hidden native
        select. #1011 made the overlay registry the single Escape and
        outside-press dispatcher; a mode dropdown that does not register its
        overlay would never dismiss on an outside press or an Escape. This
        pins both consumers (fill and border) register, by both dismissal
        channels — the border row is the one that regressed. The fill row is
        the control: it already registered.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="mode_dropdown_press"
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
            # Border first: the regression. The mode row opens its dropdown
            # on a click of the trigger; a dismissal must close it.
            border = page.evaluate(
                _js("LayerControl/mode_dropdown_outside_press"),
                {"which": "border", "how": how},
            )
            assert border["ok"], border
            assert border["openAfterClick"], border
            assert border["dismissed"], (
                f"border mode dropdown did not close on {how}: {border}"
            )
            # Fill: control, already registered — must behave the same.
            fill = page.evaluate(
                _js("LayerControl/mode_dropdown_outside_press"),
                {"which": "fill", "how": how},
            )
            assert fill["ok"], fill
            assert fill["openAfterClick"], fill
            assert fill["dismissed"], (
                f"fill mode dropdown did not close on {how}: {fill}"
            )
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("which", ["border", "fill"])
    @pytest.mark.parametrize("how", ["outside", "escape"])
    def test_style_mode_dropdown_overlay_contract(self, browser, tmp_path, which, how):
        """The shared dropdown overlay contract holds on both mode rows.

        Every dropdown surface must register with the overlay registry (the
        single Escape/outside-press dispatcher from #1011). Four behaviours pin
        the contract: opening registers the dropdown above its host panel
        (so an Escape or outside press closes the dropdown first and not the
        panel), and the trigger regains focus after the dismissal. The border
        row is the regression this guards; the fill row is the control.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="dropdown_overlay_contract"
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
                _js("LayerControl/dropdown_overlay_contract"),
                {"which": which, "how": how},
            )
            assert result["ok"], result
            assert result["openAfterClick"], result
            assert result["panelOpenBefore"], result
            assert result["focusedTriggerBefore"], result
            assert result["dismissed"], (
                f"{which} mode dropdown did not close on {how}: {result}"
            )
            assert result["panelStayedOpen"], (
                f"{how} closed the style panel instead of only the dropdown: {result}"
            )
            assert result["focusReturned"], (
                f"{which} trigger did not regain focus after {how}: {result}"
            )
            assert not errors, f"JS errors: {errors}"

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
            base = Path(__file__).resolve().parents[4] / "foliplus" / "locale"
            strings = set()
            # Label-class keys only: the strings that render as a form-row
            # label in a shared-label-column panel. A locale edit that
            # lengthens any of them is caught here instead of silently
            # wrapping the row again.
            label_keys = {
                "LayerControl.style_method",
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
                "HeatmapControl.classify_method",
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

    def test_style_fill_value_paints_the_map_by_value(self, browser, tmp_path):
        """The by-value mode repaints the map, and solid flattens it back.

        The ramp mode maps each polygon's numeric property to a color, so the
        rendered SVG carries one fill per value. Reading the panel's color bar
        only proves the DOM changed; this reads the map's own path elements
        under the leaflet-map-pane and asserts the real paint. Switching to the
        solid mode flattens every polygon to the same fill, so the distinct
        painted-fill set collapses to one — the negative control that a single
        color really is one color, and that "ramp" was what made them differ.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug="style_fill_value_paints_map",
        ) as (page, errors):
            self._open_style_ramp(page)

            # The ramp mode is the default for a numeric field, but set it
            # explicitly so the assertion targets the mode, not an accident of
            # the default.
            set_mode = page.evaluate(
                _js("LayerControl/set_fill_mode"), {"mode": "value"}
            )
            assert set_mode["ok"], f"could not enter the value mode: {set_mode}"
            page.wait_for_timeout(300)

            ramp = page.evaluate(_js("LayerControl/read_map_fills"))
            assert ramp["count"] >= 3, (
                f"expected at least the three polygons painted, got {ramp}"
            )
            assert ramp["present"] >= 3, (
                f"the ramp mode did not paint distinct per-value fills: {ramp}"
            )
            assert len(ramp["fills"]) >= 3, (
                f"the ramp mode did not paint at least three distinct colors: {ramp}"
            )

            # Negative control: the solid mode paints every polygon the same
            # fill, so the distinct painted-fill set collapses to one value.
            set_mode = page.evaluate(
                _js("LayerControl/set_fill_mode"), {"mode": "solid"}
            )
            assert set_mode["ok"], f"could not enter the solid mode: {set_mode}"
            page.wait_for_timeout(300)

            solid = page.evaluate(_js("LayerControl/read_map_fills"))
            assert solid["count"] >= 3, f"the solid mode dropped polygons: {solid}"
            assert solid["present"] == 1, (
                f"the solid mode did not flatten to one fill: {solid}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_style_panel_opens_downward_and_scrolls_inside(self, browser, tmp_path):
        """The pinned style card opens downward and scrolls its own content.

        A row near the top has plenty of room below, so placement keeps the card
        under it and caps it to the measured strip instead of the old fixed
        400px token. The content's own scrollbar keeps the long panel usable,
        and a wheel over the card must stay inside it instead of chaining to the
        layer list behind.
        """
        data = load_geojson("common", "polygons_fuzhou_3offset")
        layer = folium.GeoJson(json.dumps(data), name="Polygon data")
        with use_page(
            self._make_page, browser, tmp_path, layer, slug="row_panel_scroll"
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
            page.wait_for_timeout(200)

            before = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert before["ok"], before
            assert before["position"] == "fixed", before
            assert before["pinned"] is True, before
            assert before["opensDownward"], (
                f"the pinned card opened above its row: {before}"
            )
            gap = before["panel"]["top"] - before["row"]["bottom"]
            assert 0 < gap <= 8, before
            assert before["content"]["overflowY"] == "auto", before
            assert before["content"]["panelMaxHeight"] != "400px", (
                "placement should write the measured strip, not the token "
                f"default: {before['content']}"
            )
            assert (
                before["content"]["scrollHeight"] > before["content"]["clientHeight"]
            ), f"the long style panel does not need its own scrollbar: {before}"

            rect = before["content"]["rect"]
            page.mouse.move(
                rect["left"] + rect["width"] / 2, rect["top"] + rect["height"] / 2
            )
            page.mouse.wheel(0, 240)
            page.wait_for_timeout(300)

            after = page.evaluate(
                _js("LayerControl/read_row_panel_scroll"), {"ramp": True}
            )
            assert after["content"]["scrollTop"] > 0, (
                "the wheel over the card did not scroll its content: "
                f"{before['content']} -> {after['content']}"
            )
            assert after["listScrollTop"] == before["listScrollTop"], (
                "the wheel chained to the layer list instead of the card: "
                f"{before['listScrollTop']} -> {after['listScrollTop']}"
            )
            assert after["opensDownward"], (
                f"the card left its downward placement after scrolling: {after}"
            )
            assert not errors, f"JS errors: {errors}"

    # ── zoom-range browser probes ────────────────────────────────────
    #
    # CSS/interaction verification for the zoom-range row: dual-thumb
    # clamp, out-of-range dimming + tooltip, zoomend marker movement,
    # and the native carrier (GridLayer minZoom/maxZoom) measured against
    # a real Leaflet tile container.

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
        fg = folium.FeatureGroup(name="ZROffProbe", overlay=True, show=False)
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
        folium.FeatureGroup(name="ZROffReload", overlay=True, show=False).add_to(m)
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
        fg = folium.FeatureGroup(name="Points", show=True)
        folium.GeoJson(
            json.dumps(
                feature_collection(
                    *[
                        point_feature(119.30 + i * 0.01, 26.08, {"val": i})
                        for i in range(3)
                    ]
                )
            )
        ).add_to(fg)
        fg.add_to(m)
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

    def test_slider_scale_ends_center_on_their_thumbs(self, browser, tmp_path):
        """The end numbers of a slider scale sit centred on the rail's ends.

        The values row takes the track's half-thumb inset, so the rail's ends
        are the values row's edges and each end number has to be centred on
        its own edge -- directly under the thumb parked there. Flush numbers
        (outer edges on the row's edges) read as a scale whose ends belong to
        the field rather than to the thumbs. Both rows that carry numbers are
        measured in the live style panel: the single opacity thumb and the
        dual zoom-range pair. The same pass pins that the centring did not
        widen the control (a centred number overhangs the field by half its
        width, which is why the flush layout existed) and did not clip the
        numbers against the panel's scroll box.
        """
        overlay = folium.FeatureGroup(name="Overlay", overlay=True, show=True)
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
                labels = row["labels"]
                # A mirrored row keeps the logical anchors, so the minimum
                # names the right edge and the maximum the left one.
                if mirrored:
                    ends = (
                        ("min", labels["min"], row["track"]["right"]),
                        ("max", labels["max"], row["track"]["left"]),
                    )
                else:
                    ends = (
                        ("min", labels["min"], row["track"]["left"]),
                        ("max", labels["max"], row["track"]["right"]),
                    )
                for side, label, edge in ends:
                    assert label is not None, f"{name} has no {side} number: {row}"
                    assert label["visible"], f"{name} {side} number is hidden: {row}"
                    drift = abs(label["box"]["centerX"] - edge)
                    assert drift <= 1.0, (
                        f"{name} {side} number is not centred on the rail's "
                        f"end: centre {label['box']['centerX']:.2f}px vs edge "
                        f"{edge:.2f}px, drift {drift:.2f}px"
                    )

                # The overhang of a centred end number has to land inside the
                # panel's scroll box; outside it the row's hidden overflow
                # clips the digits.
                content = row["content"]
                assert content is not None, f"no style panel around {name}: {row}"
                for side, label, _edge in ends:
                    assert label["box"]["left"] >= content["left"] - 0.5, (
                        f"{name} {side} number is clipped on the left: "
                        f"{label['box']} vs {content}"
                    )
                    assert label["box"]["right"] <= content["right"] + 0.5, (
                        f"{name} {side} number is clipped on the right: "
                        f"{label['box']} vs {content}"
                    )

                # Not widened: the slider is the track plus the half-thumb
                # inset on each side, and the values row still spans the track.
                slider, track = row["slider"], row["track"]
                thumb_width = row["thumbs"][0]["box"]["width"]
                assert abs(slider["width"] - (track["width"] + thumb_width)) <= 1.0, (
                    f"the {name} slider was widened: {slider} vs track {track}"
                )
                assert abs(row["values"]["width"] - track["width"]) <= 1.0, (
                    f"the {name} values row no longer spans the track: {row}"
                )

            check_row("opacity", result["opacity"], thumbs=1)
            check_row("zoom range", result["zoomRange"], thumbs=2)

            # The dual row keeps the current-level number the flush layout had.
            current = result["zoomRange"]["labels"]["current"]
            assert current is not None, f"zoom range lost its current number: {result}"

            # A mirrored page keeps the same invariant: the logical anchors
            # swap sides, the physical shift flips with them, so every number
            # still centres on the edge (and therefore the thumb) it names.
            page.evaluate(_js("LayerControl/set_document_dir_rtl"))
            mirrored = page.evaluate(_js("LayerControl/read_slider_label_alignment"))
            assert mirrored.get("error") is None, f"RTL setup failed: {mirrored}"
            check_row("opacity (rtl)", mirrored["opacity"], thumbs=1, mirrored=True)
            check_row(
                "zoom range (rtl)", mirrored["zoomRange"], thumbs=2, mirrored=True
            )
            assert not errors, f"JS errors: {errors}"

    # ── Row lookup by data-layer-id, not by registry / DOM position ──
    #
    # Each of these three scrambles the registry or the panel so the two
    # orders disagree, then asserts the mutation landed on the row named by
    # the layer's id. A positional lookup would have hit a neighbor.

    def test_late_layer_fill_swatch_reads_authored_color(self, browser, tmp_path):
        """#679: bad script order — the control's own script lands before a
        layer's JS global, so the registry entry starts at `layer: null`
        with a pending `kind`. The late-binding hook must rewrite the entry
        when the real object arrives via `layeradd`; otherwise every
        consumer that reads `layerInfo.layer` directly falls back to
        Leaflet's own default `#3388ff` forever. This gate is the raw
        user-visible symptom: the fill swatch must show the author's
        declared `fillColor`, not the fallback.

        `_make_page` puts LayerControl first and the layer second — the
        natural folium render order, so the JS global genuinely lands
        after the control's script. No test-only reordering.
        """
        fg = folium.FeatureGroup(name="Zone", overlay=True, show=True)
        folium.Polygon(
            locations=leaflet_path("LayerControl", "polygon_focus_box"),
            fill_color="#ffa500",
            fill=True,
        ).add_to(fg)
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="late_fill_swatch",
        ) as (page, errors):
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/late_layer_fill_swatch"))
            assert result is not None and result.get("panel") is True, (
                f"probe did not open the style panel: {result}"
            )
            # The swatch reads the author's declared `fillColor`, not
            # Leaflet's default `#3388ff` (the fallback that used to be
            # sticky when the entry stayed pending).
            assert result["fillValue"].lower() == "#ffa500", (
                f"fill swatch must read the author's declared fillColor, got "
                f"{result['fillValue']!r}: {result}"
            )
            # And no entry is still pending once folium's script has
            # streamed — that is the invariant the fix writes back.
            assert result["unresolved"] == [], (
                f"every layer must be resolved after the script stream, got "
                f"unresolved={result['unresolved']} on row {result.get('id')!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_attribution_only_topmost_visible(self, browser, tmp_path):
        """Regression guard: with multiple base layers checked, the
        attribution control shows exactly one entry — the topmost visible
        base in registry order (list order = z-order).

        Before the fix, foliplus kept a single ``lastAttribution`` cache
        and diffed the new entry against it. When a second base was
        checked under an already-visible first base, Leaflet's own
        ``layeradd`` handler had already added its entry and the
        diff-against-cache early-returned without cleaning the newcomer
        up, so the attribution line stacked every checked base's credit.

        The fix clears the entry table on every sync and rebuilds it from
        a single registry-order scan: the first visible base from
        ``firstBaseIdx`` wins. This is the user's stated semantics —
        "the base furthest forward in the list order shows its attr".

        The snippet walks uncheck A → uncheck B → check B → check A →
        uncheck A so every intermediate state exercises the full rebuild
        through a real browser with Leaflet's attribution control in the
        loop. ``tiles=None`` suppresses folium's default OSM so the test
        focuses on user basemaps; A registers first (index 0, topmost),
        so A's attr wins whenever A is visible, regardless of check order.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_topmost.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_topmost.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_only_topmost_visible"))
            assert result is not None and not result.get("error"), result
            steps = result["steps"]
            assert len(steps) == 5, f"expected 5 steps, got {len(steps)}: {result}"
            for step in steps:
                assert step["r"]["ok"] is True, f"toggle failed: {step}"
            # A registers first (index 0 = topmost), so A wins whenever
            # A is visible. The snippet toggles A and B through five
            # intermediate states; each must show exactly the topmost
            # visible base's attr.
            assert result["initial"]["entries"] == {"A attr": 1}, result["initial"]
            # Step 1 (uncheck A): B is now the only visible base.
            assert steps[0]["state"]["entries"] == {"B attr": 1}, steps[0]
            # Step 2 (uncheck B): no user basemap visible.
            assert steps[1]["state"]["entries"] == {}, steps[1]
            # Step 3 (check B): B is visible again.
            assert steps[2]["state"]["entries"] == {"B attr": 1}, steps[2]
            # Step 4 (check A): A is at index 0 (topmost in registry
            # order), so A's attr wins even though A was checked second.
            # This is the regression guard — the old "last-checked wins"
            # rule would have kept B's attr here.
            assert steps[3]["state"]["entries"] == {"A attr": 1}, steps[3]
            # Step 5 (uncheck A): B is now the only visible base.
            assert steps[4]["state"]["entries"] == {"B attr": 1}, steps[4]

    def test_attribution_order_change(self, browser, tmp_path):
        """Regression guard: reordering base layers changes the attribution.

        The user's stated semantics: "adjusting the basemap layer order
        changes the attribution". ``moveLayerUp`` / ``moveLayerDown``
        reorder the registry and call ``enforceOrder`` → ``syncAttribution``,
        so the topmost visible base's attr must follow the reorder.

        A registers first (index 0, topmost), B registers second.
        Initially A's attr wins. After ``moveLayerUp("B")``, B is at
        index 0 and B's attr wins. After ``moveLayerDown("B")``, A is
        back at index 0 and A's attr wins again.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_order.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_order.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_order_change"))
            assert result is not None and not result.get("error"), result
            # Initial: A is at index 0 (topmost), so A's attr wins.
            assert result["initial"]["entries"] == {"A attr": 1}, result["initial"]
            # Step 1 (moveLayerUp B): B moves to index 0, B's attr wins.
            assert result["steps"][0]["ok"] is True, result["steps"][0]
            assert result["steps"][0]["state"]["entries"] == {"B attr": 1}, result[
                "steps"
            ][0]
            # Step 2 (moveLayerDown B): B moves back, A's attr wins again.
            assert result["steps"][1]["ok"] is True, result["steps"][1]
            assert result["steps"][1]["state"]["entries"] == {"A attr": 1}, result[
                "steps"
            ][1]

    def test_attribution_sync_no_flicker(self, browser, tmp_path):
        """Flicker guard: reading the attribution table in the same JS
        task as the checkbox click shows exactly one entry — not two.

        Leaflet's ``layeradd`` fires ``addAttribution`` synchronously
        during the click. If ``syncAttribution`` were debounced, the
        table would carry both the pre-existing topmost base's attr and
        the newly-added base's attr for ~50 ms — a visible flicker. The
        synchronous call in ``visibility.ts`` rebuilds the table right
        after the click is processed, before ``debouncedEnforce`` runs.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="A",
            attr="A attr",
            overlay=False,
            max_zoom=18,
        ).add_to(m)
        # B starts hidden: turning it ON is the flicker trigger —
        # Leaflet's synchronous addAttribution fires during the click,
        # and only a synchronous syncAttribution can clear it before the
        # same-JS-task read.
        folium.TileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="B",
            attr="B attr",
            overlay=False,
            max_zoom=20,
            show=False,
        ).add_to(m)
        _expand_panel(m)
        _write_html(m, tmp_path / "attribution_sync.html")
        with use_raw_page(browser.new_page) as page:
            page.goto(
                f"file://{tmp_path / 'attribution_sync.html'}",
                wait_until="domcontentloaded",
            )
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            panel_ready(page)
            result = page.evaluate(_js("LayerControl/attribution_sync_no_flicker"))
            assert result is not None and not result.get("error"), result
            # Same-JS-task read after the click: exactly one entry. A
            # debounced syncAttribution would leave Leaflet's synchronous
            # addAttribution("B attr") in the table alongside the
            # pre-existing entry — 2 entries instead of 1.
            assert len(result["entries"]) == 1, result

    def test_marker_color_keeps_chassis_container(self, browser, tmp_path):
        """P1: picking a marker color must not leave the marker as glyph-only.

        The reported regression: after choosing a chassis color, the marker's
        pin (the awesome-markers sprite container) disappears and only the
        glyph <i> remains. The row is now [color swatch | opacity number]; the
        chassis write drives the real Leaflet runtime, so the marker element
        must still carry the `awesome-marker-icon-<color>` chassis class and a
        non-empty background after the write, and Reset must restore the
        author icon.
        """
        fg = folium.FeatureGroup(name="Points", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="P1", icon=folium.Icon(color="red")).add_to(
            fg
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_chassis",
        ) as (page, errors):
            self._open_style_ramp(page)
            # before: author chassis + glyph DOM
            before = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert before["ok"], before
            assert before["marker"]["hasChassisClass"], (
                f"author marker has no chassis class: {before}"
            )
            page.screenshot(
                path=str(tmp_path / "marker_color_before.png"), full_page=True
            )

            # write the preset blue at alpha 100 through the swatch row
            written = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert written["ok"], written
            page.screenshot(
                path=str(tmp_path / "marker_color_after.png"), full_page=True
            )
            assert written["marker"] is not None, (
                f"marker element missing after the write: {written}"
            )
            # The chassis container must survive: the sprite class + a real
            # background image, and the glyph must still be painted.
            assert written["marker"]["hasChassisClass"], (
                f"marker lost its chassis container after the write: {written}"
            )
            assert "awesome-marker-icon-blue" in written["marker"]["cls"], (
                f"chassis color did not re-derive: {written}"
            )
            assert written["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {written}"
            )
            # The glyph must survive the write. When the author's glyph name
            # is not a FontAwesome 6 name (here: the bootstrap glyphicon
            # info-sign), the honest degradation keeps the author's inner
            # glyph verbatim — the chassis changes, the symbol does not.
            glyph_cls = (written["glyph"] or {}).get("cls") or ""
            assert written["glyph"], f"glyph missing after the write: {written}"
            assert (
                "foliplus-marker-glyph" in glyph_cls.split() or "glyphicon" in glyph_cls
            ), f"glyph not painted after the write: {written}"

    def test_marker_color_custom_chassis_paint(self, browser, tmp_path):
        """Task-76: the marker chassis accepts a custom hex + opacity.

        The row is [color swatch | opacity number]. Three paint paths:
          • preset hex at alpha 100  → library sprite class, NO chassis span
            (author-identical, acceptance ③);
          • preset hex at alpha <100 → chassis <span> carries the sprite with
            its own opacity, the glyph <i> is a sibling and stays opaque
            (acceptance ①);
          • custom hex (any alpha)    → chassis <span> carries a mask (same
            sprite as mask-image) + flat background-color, glyph opaque
            (acceptance ②).
        """
        fg = folium.FeatureGroup(name="Points", overlay=True, show=True)
        folium.Marker([26.08, 119.30], name="P1", icon=folium.Icon(color="red")).add_to(
            fg
        )

        with use_page(
            self._make_page,
            browser,
            tmp_path,
            fg,
            slug="marker_color_custom",
        ) as (page, errors):
            self._open_style_ramp(page)

            # ③ preset hex at alpha 100 → sprite class, NO span.
            preset = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 100},
            )
            assert preset["ok"], preset
            assert preset["marker"]["hasChassisClass"], (
                f"preset alpha 100 lost the sprite class: {preset}"
            )
            assert "awesome-marker-icon-blue" in preset["marker"]["cls"], (
                f"preset alpha 100 did not re-derive blue: {preset}"
            )
            assert preset["marker"]["hasSpan"] is False, (
                f"preset alpha 100 must NOT take a chassis span: {preset}"
            )
            assert preset["glyph"] and preset["glyph"]["opacity"] == "1", (
                f"preset alpha 100 glyph not opaque: {preset}"
            )

            # ① preset hex at alpha 50 → chassis span + sprite + opacity 0.5.
            half = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#38aadd", "opacity": 50},
            )
            assert half["ok"], half
            assert half["marker"]["hasSpan"] is True, (
                f"preset alpha 50 must use a chassis span: {half}"
            )
            assert (
                half["span"] is not None and "url(" in half["span"]["backgroundImage"]
            ), f"preset alpha 50 span lost the sprite: {half}"
            assert half["span"]["opacity"] == "0.5", (
                f"preset alpha 50 span opacity: {half}"
            )
            assert half["marker"]["containerBackgroundImage"] == "none", (
                f"preset alpha 50 container must clear the sprite: {half}"
            )
            assert half["glyph"] and half["glyph"]["opacity"] == "1", (
                f"preset alpha 50 glyph must stay opaque: {half}"
            )

            # ② custom hex at alpha 50 → chassis span + mask + flat bg-color.
            custom = page.evaluate(
                _js("LayerControl/marker_color_custom_probe"),
                {"hex": "#ff9900", "opacity": 50},
            )
            assert custom["ok"], custom
            assert custom["marker"]["hasSpan"] is True, (
                f"custom hex must use a chassis span: {custom}"
            )
            assert (
                custom["span"] is not None and "url(" in custom["span"]["maskImage"]
            ), f"custom hex span lost the mask: {custom}"
            assert custom["span"]["backgroundColor"] == "rgb(255, 153, 0)", (
                f"custom hex span flat color: {custom}"
            )
            assert custom["span"]["opacity"] == "0.5", (
                f"custom hex span opacity: {custom}"
            )
            assert custom["glyph"] and custom["glyph"]["opacity"] == "1", (
                f"custom hex glyph must stay opaque: {custom}"
            )
