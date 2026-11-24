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
        geo = folium.GeoJson(_geo_zone, name="Point layer")
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
        folium.GeoJson(
            json.dumps(
                feature_collection(point_feature(119.30, 26.08, {"val": 26.08}))
            ),
            name="Points",
            show=True,
        ).add_to(m)
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
        folium.GeoJson(
            json.dumps(feature_collection(point_feature(119.30, 26.08))),
            name="Overlay A",
            overlay=True,
            show=True,
        ).add_to(m)
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

    @pytest.mark.parametrize("fill_mode", ["original", "solid", "value"])
    def test_style_fill_opacity_row_in_every_mode(self, browser, tmp_path, fill_mode):
        """The fill opacity row is the last row of the fill detail in every mode.

        The row sits after the scheme row and before the border mode row, holds
        an editable number input in solid and value mode and the readonly box in
        original mode, and its box carries the shared numeric width rather than
        a content-sized one.
        """
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            self._ramp_layer(),
            slug=f"fill_opacity_row_{fill_mode}",
        ) as (page, errors):
            self._open_style_ramp(page)
            result = page.evaluate(
                _js("LayerControl/read_fill_opacity_rows"),
                {"fillMode": fill_mode},
            )
            assert result.get("ok"), result
            # Exactly one of the two shapes: the editable input, or the
            # readonly box — never both, never neither.
            assert result["hasOpacityInput"] != result["hasOpacityBox"], result
            assert result["opacity"] is not None, result
            # The box carries the shared 52px width token, not a
            # content-sized one.
            assert result["opacity"]["w"] == pytest.approx(52, abs=1), result
            assert not errors, f"JS errors: {errors}"

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
        fg = folium.GeoJson(
            json.dumps(load_geojson("LayerControl", "polygon_focus_box")),
            name="Zone",
            overlay=True,
            show=True,
            style_function=lambda f: {"fillColor": "#ffa500", "fill": True},
        )
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
