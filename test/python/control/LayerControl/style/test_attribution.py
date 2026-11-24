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
