"""Generic-filter browser assertions: the hidden class reaches every element."""

from __future__ import annotations

import re

import folium
from conftest import _js, leaflet_path, make_browser_page, use_page

from foliplus import LayerControl


class TestFilterApplyBrowser:
    """The generic filter's hidden class must reach every paint element.

    The design contract puts the hidden class on the element itself, so a
    single rule (`.foliplus-feature-filtered { display: none; }`) hides the
    path, the marker icon, its drop shadow, a DivIcon marker's element, and a
    LayerGroup leaf. The assertions read the *computed* display (not just the
    class) so a rule that only wins with !important fails here: if the rule
    needs !important to beat a Leaflet inline style, one computed display
    stays non-none.
    """

    @staticmethod
    def _probe(browser, tmp_path, slug="filter_apply"):
        """Map + LayerControl, expose the control as window.__layerCtrl."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        LayerControl().add_to(m)
        html = m.get_root().render()
        html, n = re.subn(
            r"(new LayerControl\(\{ position: CONFIG\.position \}\)\.addTo\(map\);)",
            r"window.__layerCtrl = \1",
            html,
            count=1,
        )
        assert n == 1
        page, errors = make_browser_page(browser, tmp_path, html, slug)
        page.wait_for_selector(".foliplus-layer-ctrl", state="attached", timeout=10000)
        return page, errors

    def test_filter_hides_every_paint_element(self, browser, tmp_path):
        """One layer per class filtered; every enumerated element is hidden."""
        with use_page(self._probe, browser, tmp_path) as (page, errors):
            r = page.evaluate(
                _js("LayerControl/apply_filter_hides_classes"),
                {
                    "poly": leaflet_path(
                        "LayerControl", "polygon_fuzhou_triangle_small"
                    ),
                    "line": leaflet_path("common", "line_fuzhou_diag"),
                    "groupPoly": leaflet_path(
                        "LayerControl", "polygon_fuzhou_triangle_group"
                    ),
                },
            )
            assert r is not None, "LayerAPI/manager or runtimeStore missing"
            assert r["hasVisibleDomOf"], (
                "visibleDomOf not on window.foliplus.core.layer"
            )
            # The carrier must enumerate the shadow and the group leaf through
            # the real visibleDomOf, so the probe set covers both branches.
            by_id = {p["id"]: p for p in r["out"]}
            assert set(by_id) >= {
                "__flt_poly__",
                "__flt_line__",
                "__flt_circle__",
                "__flt_marker__",
                "__flt_div__",
                "__flt_group__",
            }, f"missing probe layers: {set(by_id)}"
            for probe in r["out"]:
                ctx = probe["id"]
                assert probe["elements"], f"{ctx}: no element enumerated"
                for el in probe["elements"]:
                    assert el["displays"], f"{ctx}/{el['type']}: no display read"
                    for d in el["displays"]:
                        assert d == "none", (
                            f"{ctx}/{el['type']}: display={d!r} not none"
                        )
                    for c in el["classed"]:
                        assert c is True, f"{ctx}/{el['type']}: class not applied"
            # The layeradd replay (controller layeradd -> findLayer ->
            # replayFilter) must re-apply the class after the layer is re-added.
            for probe in r["out"]:
                replay = probe.get("replay")
                assert isinstance(replay, list), (
                    f"{probe['id']}: replay error: {replay}"
                )
                for displays in replay:
                    for d in displays:
                        assert d == "none", (
                            f"{probe['id']}: replay display={d!r} not none"
                        )
            assert not errors, f"JS errors: {errors}"
