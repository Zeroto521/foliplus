"""Scheme picker host under native and pseudo fullscreen.

The picker portals its color list into the surface that covers the trigger.
Native fullscreen is reported by the Fullscreen API; the FullscreenControl's
pseudo-fullscreen fallback is a covering container (a class on the map
container) that emits no `fullscreenchange`. A list parked in <body> therefore
sat behind the pseudo container and every color row was unclickable.

These tests drive the real surfaces: a real press on the fullscreen toggle, a
real press on the scheme trigger and a real press on a color row. They assert
the point at the row's centre resolves into the list (`elementFromPoint`), which
is the user-visible contract the bug broke.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import FullscreenControl, LayerControl


def _ramp_layer() -> folium.GeoJson:
    """A polygon layer with a numeric property, for the fill ramp arm."""
    data = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"value": 10 + i},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [119.28 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.06],
                            [119.32 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.10],
                            [119.28 + i * 0.01, 26.06],
                        ]
                    ],
                },
            }
            for i in range(3)
        ],
    }
    return folium.GeoJson(json.dumps(data), name="Polygon data")


def _layer_map(**ctrl_kwargs) -> folium.Map:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl(**ctrl_kwargs).add_to(m)
    FullscreenControl(hide_self=True, hide_others=False).add_to(m)
    _ramp_layer().add_to(m)
    return m


def _make_page(browser, tmp_path, *, pseudo: bool):
    """Build the map page; `pseudo` disables the native API before scripts run.

    The API is disabled by an inline script in the rendered HTML, so the
    FullscreenControl's first `isEnabled` read takes the fallback branch — the
    same fixture shape the FullscreenControl pseudo tests use.
    """
    html = _layer_map().get_root().render()
    if pseudo:
        html = html.replace(
            "<body>",
            """<body>
        <script>
          Object.defineProperty(document, 'fullscreenEnabled', {
            value: false,
            configurable: true,
          });
          document.exitFullscreen = undefined;
          document.documentElement.requestFullscreen = undefined;
        </script>""",
        )
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "scheme_host_pseudo" if pseudo else "scheme_host_native",
    )


def _open_ramp(page) -> None:
    """Expand the layer control, open the style drawer and settle the ramp arm."""
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)


def _open_list(page) -> dict:
    """Press the scheme trigger and return the live list geometry."""
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], f"the ramp arm did not settle: {ready}"
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )
    host = page.evaluate(_js("LayerControl/read_scheme_picker_host"))
    assert host["ok"], f"the scheme list did not open: {host}"
    assert host["dropdownPresent"], host
    return host


class TestSchemePickerHostBrowser:
    """The portalled list follows the surface that covers the trigger."""

    def test_pseudo_fullscreen_mounts_the_list_in_the_covering_container(
        self, browser, tmp_path
    ):
        """Pseudo-fullscreen: the list lives inside the covering container.

        The container carries z-index above the document, so a list left in
        <body> is painted under it. Mounting into the container puts the list in
        the same stacking context as the panel, where its own z band wins; the
        hit test proves a row is reachable with the pointer.
        """
        with use_page(_make_page, browser, tmp_path, pseudo=True) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_on"))

            _open_ramp(page)
            host = _open_list(page)
            assert host["pseudoActive"], host
            assert host["hostIsPseudo"], (
                "the list must mount inside the pseudo-fullscreen container, got "
                f"{host['hostTag']}.{host['hostClass']}"
            )
            assert host["hitInsideDropdown"], (
                "the point at the color row's centre must resolve inside the "
                f"list, hit {host['hitTag']}.{host['hitClass']}"
            )

            # The row is genuinely selectable: a press commits and keeps the
            # drawer on screen.
            page.mouse.click(host["targetX"], host["targetY"])
            state = page.evaluate(_js("LayerControl/style_scheme_portal_state"))
            assert state["drawerVisible"], (
                f"the color press dismissed the drawer: {state}"
            )
            assert state["triggerTitle"] == host["targetName"], (
                f"the pick did not commit {host['targetName']}: {state}"
            )
            assert not state["dropdownPresent"], state

            # Leaving pseudo-fullscreen must not leave the list behind in the
            # container: either it follows back to the document host or it
            # closes. The press that exits fullscreen is an outside click, so
            # closing is the expected shape; a stuck list in the container is
            # the failure either way.
            _open_list(page)
            page.evaluate(_js("FullscreenControl/click_toggle"))
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_off"))
            after = page.evaluate(_js("LayerControl/read_scheme_picker_host"))
            if after["dropdownPresent"]:
                assert not after["hostIsPseudo"], (
                    f"the list stayed inside the pseudo container after exit: {after}"
                )
            assert after["panelVisible"], (
                f"exiting fullscreen dismissed the drawer: {after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_native_fullscreen_keeps_the_list_reachable(self, browser, tmp_path):
        """Native fullscreen: the list still covers the fullscreen surface.

        The injected resolver normalizes a fullscreen <html> to the document
        host, which is inside the fullscreen element; the hit test proves the
        row is reachable while the document is fullscreen.
        """
        with use_page(_make_page, browser, tmp_path, pseudo=False) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(
                _js("FullscreenControl/wait_fullscreen_element_present")
            )

            _open_ramp(page)
            host = _open_list(page)
            assert host["fullscreenElementTag"], (
                f"the browser did not enter native fullscreen: {host}"
            )
            assert host["insideFullscreenElement"], (
                "the list must stay inside the fullscreen element, got "
                f"{host['hostTag']}.{host['hostClass']}"
            )
            assert host["hitInsideDropdown"], (
                "the point at the color row's centre must resolve inside the "
                f"list, hit {host['hitTag']}.{host['hitClass']}"
            )
            assert not errors, f"JS errors: {errors}"
