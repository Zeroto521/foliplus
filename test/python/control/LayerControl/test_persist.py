"""Split of test_panel.py by dimension."""

from __future__ import annotations

import json

import re

import time

from pathlib import Path

import folium

import pytest

from conftest import (
    _js,
    assert_map_unchanged,
    feature_collection,
    heatmap_ready,
    leaflet_path,
    leaflet_points,
    load_geojson,
    make_browser_page,
    map_center_zoom,
    panel_ready,
    point_feature,
    render,
    snippet,
    snippet_fn,
    touch_drag,
    use_page,
    use_raw_page,
)

from playwright.sync_api import TimeoutError

from foliplus import HeatmapControl, LayerControl

from .helper import _expand_panel, _geo_mixed, _write_html

from .helper_browser import LayerControlBrowserBase

class TestPanelBrowser(LayerControlBrowserBase):
    def test_load_saved_order_restore_order(self, browser, tmp_path):
        """loadSavedOrder restores previously saved order from localStorage."""
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            folium.FeatureGroup(name="A", overlay=True, show=True),
            folium.FeatureGroup(name="B", overlay=True, show=True),
            folium.FeatureGroup(name="C", overlay=True, show=True),
            slug="saved_order",
        ) as (page, _):
            result = page.evaluate(_js("LayerControl/read_layer_ids"))
            assert result is not None
            assert result["count"] >= 3
    def test_registry_matches_map_after_reload(self, browser, tmp_path):
        """The registry holds one entry per rendered row, and its ids are stable.

        Confirms the reload page's CONFIG data lands with one id per feature group
        and that the registry view and the map's own layer set agree, before any
        hiding happens. Anything the persistence funnel drops would show here.

        The page declares one overlay with ``show=False``, but that is honored
        by folium's own renderer, not by LayerControl: folium 0.14.0 emits
        ``.addTo(map)`` unconditionally and never removes it, so on that version
        every declared layer starts on the map. What this test pins is therefore
        the registry <-> map agreement itself, not the declared visibility --
        a mismatch shows up the same way either way.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_registry_ids.html"
        _write_html(m, html_path)

        with use_raw_page(browser.new_page) as page:
            page.goto(f"file://{html_path}", wait_until="domcontentloaded")
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=10000,
            )
            page.wait_for_timeout(500)

            info = page.evaluate(_js("LayerControl/read_hidden_state"))
            # Overlays only: the two TileLayers are base rows, which the
            # selector excludes by class. A [data-layer-id] selector would count
            # each layer twice, since renderLayerItem stamps the id on the row
            # and again on its count cell.
            assert len(info["rows"]) == 2, f"expected 2 overlay rows, got {info}"
            ids = [r["id"] for r in info["rows"]]
            # Distinct ids: a duplicate would make the persisted hidden set apply
            # to only one of the two.
            assert len(set(ids)) == len(ids), f"duplicate layer ids in registry: {ids}"
            # The fixture throws if a rendered row has no registry entry, since
            # such a row's state has no source of truth. A null here means the
            # manager's own resolver could not find the Leaflet layer -- that
            # row cannot be added or removed, so no state on it can be honored
            # after a reload.
            unresolved = [r for r in info["rows"] if r["onMap"] is None]
            assert not unresolved, f"unresolved layers in registry: {unresolved}"
            # The registry's own flag and the Leaflet attachment agree per row.
            # Declared show=False is deliberately not asserted here: folium 0.14
            # adds every layer regardless, so the declared visibility differs
            # across folium versions while the registry/map agreement never does.
            for r in info["rows"]:
                assert r["checked"] == r["visible"] == r["onMap"], (
                    f"{r['id']}: checkbox, registry and map disagree: {info}"
                )
    def test_hidden_layers_survive_reload(self, browser, tmp_path):
        """A layer hidden by checkbox stays hidden across a reload.

        Regression guard for the persistence funnel: the write is debounced at
        100ms, so a reload inside that window previously landed on stale
        storage. Hiding happens here, the reload there -- the two pages are
        distinct so nothing survives except localStorage.

        Base layers plus a hidden-from-the-start overlay mirror a real folium
        page, where ``TileLayer(show=False)`` and the map's own theme layers
        share the panel with the data overlays.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload.html"
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

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 2, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "both overlays should be unchecked"

            # Let the debounce commit, then reload -- a reload inside the
            # window is what used to drop the write.
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
            page.wait_for_timeout(500)

            # Re-checked rows, rows whose registry entry still claims visible,
            # and layers that are still attached to the map -- each half of the
            # projection, so the assertion cannot be satisfied by faking one.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is False, (
                    f"{row['id']}: row was re-checked after reload\n{rows}"
                )
                assert row["visible"] is False, (
                    f"{row['id']}: registry says visible but the user hid it\n{rows}"
                )
                assert row["onMap"] is False, (
                    f"{row['id']}: still attached to the map after reload\n{rows}"
                )
    def test_showing_author_hidden_layers_survives_reload(self, browser, tmp_path):
        """A layer the author declared ``show=False`` and the user checked ON
        comes back ON after a reload.

        This is the reported regression: the old hidden-mirror model recorded
        ``hiddenLayerIds`` as *which layers the user hid* rather than *which layers
        are hidden*, so an id that
        folium had rendered off-map was never in the set. Checking it on
        therefore removed nothing from nothing, storage stayed ``[]``, and the
        reload restored the author's defaults.

        It is also the inverse of test_hidden_layers_survive_reload: that one
        proves the hide half of the round trip, this one proves the unhide
        half. A sweep that only walks the hidden-intent values can never reach a
        layer the
        user left visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        folium.FeatureGroup(name="Commuting Routes", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_show_hidden_reload.html"
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

            # Observe the pre-state rather than assuming folium rendered the
            # declared show=False: folium 0.14.0 adds every layer and never
            # removes it, so the rows that start off-map differ across versions.
            # The point is the round trip -- whatever starts hidden must come
            # back checked -- not which folium produced the hidden set.
            before = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert before and len(before["rows"]) == 2, f"unexpected rows: {before}"
            for row in before["rows"]:
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree at load\n{before}"
                )

            show = page.evaluate(_js("LayerControl/show_author_hidden"))
            assert show is not None and show["rows"] == 2, f"unexpected rows: {show}"
            hidden_before = sum(1 for r in before["rows"] if not r["checked"])
            assert show["checked"] == hidden_before, (
                f"expected the {hidden_before} off-map layer(s) to be shown\n{show}"
            )
            assert show["stillUnchecked"] == 0, f"rows left unchecked\n{show}"

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
            page.wait_for_timeout(500)

            # Each half of the projection is asserted separately, mirroring
            # test_hidden_layers_survive_reload: a UI-only fix (rows re-checked)
            # or a data-only fix (registry says visible) would not put the layer
            # back on the map.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert rows and len(rows["rows"]) == 2, f"expected 2 rows, got {rows}"
            for row in rows["rows"]:
                assert row["checked"] is True, (
                    f"{row['id']}: row lost its check after reload\n{rows}"
                )
                assert row["visible"] is True, (
                    f"{row['id']}: registry reverted to the author default\n{rows}"
                )
                assert row["onMap"] is True, (
                    f"{row['id']}: never re-added to the map after reload\n{rows}"
                )
    def test_author_defaults_survive_a_reload_with_no_toggle(self, browser, tmp_path):
        """Author ``show=False`` layers stay hidden when the user never touched
        the panel, and reload repeatedly.

        Guards the other half of the same change: with no visibility key in
        storage the user has made no choice, so the unhide sweep must not
        override the author's defaults. Without that guard the first reload of
        a map like the quickstart re-added every hidden overlay.

        "Author defaults" here means whatever folium rendered at load, which is
        read rather than assumed: folium 0.14.0 adds every layer regardless of
        show=False, so the default is visible on that version. The user never
        touched the panel, so storage stays empty and the invariant is that a
        reload leaves the load state untouched -- whatever it was.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12, tiles=None)
        LayerControl().add_to(m)
        folium.TileLayer(
            "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Light Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
        ).add_to(m)
        folium.TileLayer(
            "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
            name="Dark Canvas",
            attr="© OpenStreetMap",
            max_zoom=19,
            show=False,
        ).add_to(m)
        folium.FeatureGroup(name="Facility Points", overlay=True, show=False).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_author_defaults_reload.html"
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

            # No interaction at all -- the panel merely opened on load.
            initial = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert initial and len(initial["rows"]) == 1, (
                f"expected 1 row, got {initial}"
            )
            load_checked = initial["rows"][0]["checked"]
            load_storage = dict(initial["storage"])

            for _ in range(2):
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

                rows = page.evaluate(_js("LayerControl/read_hidden_state"))
                assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
                row = rows["rows"][0]
                # The load state is untouched, and the three projections of it
                # still agree -- so a reload neither re-added a hidden layer
                # nor dropped one the author left on.
                assert row["checked"] is load_checked, (
                    f"reload with no user choice changed the load state\n{rows}"
                )
                assert row["checked"] == row["visible"] == row["onMap"], (
                    f"{row['id']}: checkbox, registry and map disagree\n{rows}"
                )
                # Nothing may be persisted when the user never toggled: the
                # unhide sweep must not synthesise a choice and write it down,
                # and a runtime-created row (the color basemap) must not
                # rewrite the order the user arranged.
                assert rows["storage"] == load_storage, (
                    f"reload with no user choice wrote a stored record\n{rows}"
                )
    def test_hidden_layers_persist_across_reload(self, browser, tmp_path):
        """A hidden layer that re-registers later comes back hidden, not reset.

        HeatmapControl and MeasureControl register in their own constructor,
        which runs after the LayerControl IIFE has attached, so a hidden id can
        precede its row. The reload must leave the stored record alone -- a
        missing registry entry is not evidence that the state should go, only
        a delete is -- so when the component re-registers the layer returns the
        way the user left it instead of resurrecting visible.
        """
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        folium.FeatureGroup(name="Seed", overlay=True, show=True).add_to(m)
        _expand_panel(m)

        html_path = tmp_path / "test_hidden_reload_dynamic.html"
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

            # Register through LayerAPI, as a component's constructor would.
            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(100)

            hide = page.evaluate(_js("LayerControl/hide_then_reload"))
            assert hide is not None and hide["rows"] == 3, f"unexpected rows: {hide}"
            assert hide["stillChecked"] == 0, "all overlays should be unchecked"
            assert len(set(hide["ids"])) == 3, f"duplicate row ids: {hide}"

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
            page.wait_for_timeout(500)

            # The probes were only registered at runtime, so they are gone
            # until re-registered -- and their ids survive the reload in
            # storage: nothing pruned them merely because their registry
            # entries did not.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 1, f"expected 1 row, got {rows}"
            assert rows["rows"][0]["checked"] is False
            assert rows["rows"][0]["visible"] is False
            assert rows["rows"][0]["onMap"] is False
            key = next(k for k in rows["storage"] if "layer_state" in k)
            layers = json.loads(rows["storage"][key]).get("layers", {})
            assert {lid for lid in layers if lid.startswith("__probe")} == {
                "__probeA__",
                "__probeB__",
            }, f"reload pruned ids it had no right to drop: {rows['storage']}"
            for lid in ("__probeA__", "__probeB__"):
                assert layers[lid]["visible"] is False, (
                    f"{lid}: reload changed a stored hidden state: {rows['storage']}"
                )

            page.evaluate(_js("LayerControl/register_hidden_probes"))
            page.wait_for_timeout(300)

            # Re-registration restores the stored state instead of resetting
            # it: the probes come back off the map, unchecked, and the three
            # projections of their state still agree.
            rows = page.evaluate(_js("LayerControl/read_hidden_state"))
            assert len(rows["rows"]) == 3, f"expected 3 rows, got {rows}"
            for row in rows["rows"]:
                if row["id"].startswith("__probe"):
                    assert row["checked"] is False, (
                        f"{row['id']}: re-register reset a stored hidden state\n{rows}"
                    )
                    assert row["visible"] is False, (
                        f"{row['id']}: registry lost a stored hidden state\n{rows}"
                    )
                    assert row["onMap"] is False, (
                        f"{row['id']}: re-entered the map while hidden\n{rows}"
                    )
    def test_third_party_component_rename_survives_reload(self, browser, tmp_path):
        """A rename on a late-registering component (HeatmapControl) survives reload.

        Third-party components (HeatmapControl, MeasureControl) call
        ``registerLayer`` in their own constructors, which run after LayerControl
        has attached its panel. On the first attach the sweep runs before the
        component registers; on a later attach the component registers while
        ``applyUserState`` is replaying stored state. Without id-scoped replay the
        component's own ``name`` clobbers the user's rename on the reload -- the
        exact symptom of "renaming a third-party component does not stick
        across reload".

        This test seeds a HeatmapControl row with a user rename, reloads, and
        asserts the renamed label is the one the row paints (not the author
        default).
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

        # The persisted record the previous visit would have written: the heatmap
        # row is renamed to "My Heat" by the user. Id is the stable component id,
        # not a per-map suffix.
        seed = {
            "order": None,
            "foldedRoles": [],
            "renamedNames": {"foliplus_heatmap": "My Heat"},
            "annotations": {},
            "layers": {},
        }
        html_path = tmp_path / "test_third_party_rename_reload.html"
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
            page.wait_for_timeout(300)

            after_attach = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_attach["rowPresent"] is True, (
                f"heatmap row missing after attach: {after_attach}"
            )
            assert after_attach["storedRename"] == "My Heat", (
                f"attach dropped the stored rename: {after_attach}"
            )
            assert after_attach["label"] == "My Heat", (
                f"attach painted the author default instead of the rename: "
                f"{after_attach}"
            )

            # A second reload must land the same way: a late-registered component
            # that runs its own `registerLayer` on the second attach used to
            # clobber the rename at the point where the sweep replayed it.
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
            page.wait_for_timeout(300)

            after_reload = page.evaluate(_js("LayerControl/read_rename_state"))
            assert after_reload["rowPresent"] is True, (
                f"heatmap row missing after reload: {after_reload}"
            )
            assert after_reload["storedRename"] == "My Heat", (
                f"reload dropped the stored rename: {after_reload}"
            )
            assert after_reload["label"] == "My Heat", (
                f"reload reverted the third-party component's rename to the "
                f"author default: {after_reload}"
            )
