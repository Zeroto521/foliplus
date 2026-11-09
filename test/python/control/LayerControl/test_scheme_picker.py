"""The shared scheme-picker dropdown, driven through both of its consumers.

LayerControl's style drawer and HeatmapControl's panel mount the same
``ui/schemePicker``, so every behaviour here is a contract both must honour,
measured in Chromium against the real DOM rather than a class:

* placement — the list is portalled, paints below by default, flips above when
  the room below cannot hold it, and scrolls inside its cap (and re-places on
  resize);
* lifetime — the list never outlives the panel that opened it: collapse, the
  clear button, an outside press, control removal and pseudo-fullscreen all put
  it away, Escape closes only the list, and the press after a choice still
  lands;
* host — the list mounts into whatever surface covers the trigger, so it stays
  clickable under both native and pseudo fullscreen;
* geometry — the item strip lines up with the trigger strip in both list
  states, with a real (non-hidden) scrollbar and at DPR1/DPR2.
"""

from __future__ import annotations

import json
import re

import folium
import pytest
from conftest import (
    _CdnBrowserProxy,
    _js,
    _prefetch_cdn_cache,
    heatmap_ready,
    load_geojson,
    make_browser_page,
    panel_ready,
    snippet,
    use_page,
)

from foliplus import FullscreenControl, HeatmapControl, LayerControl

HEATMAP_TRIGGER = ".foliplus-heatmap-scheme-bar"
LAYER_TRIGGER = ".foliplus-layer-style-panel .foliplus-scheme-picker-trigger"
# Seven defaults fill the 200px list; four fit inside it.
FITTING_SCHEMES = ["Reds", "Blues", "Greens", "Purples"]

# Capture console.warn during page setup to detect duplicate overlay ids.
_WARN_PRELUDE = """
  (() => {
    const _w = console.warn;
    window.__setupWarns = [];
    console.warn = (...a) => { window.__setupWarns.push(String(a[0])); _w(...a); };
  })();
"""


def _polygon_layer() -> folium.GeoJson:
    """Overlay layer with a numeric property, for the style drawer's ramp mode."""
    return folium.GeoJson(
        json.dumps(load_geojson("common", "polygons_fuzhou_3offset")),
        name="Polygon data",
    )


def _points_group() -> folium.FeatureGroup:
    """One point layer, so the heatmap auto-selects it and opens its config."""
    fg = folium.FeatureGroup(name="Points", show=True)
    folium.GeoJson(json.dumps(load_geojson("common", "points_fuzhou_3offset"))).add_to(
        fg
    )
    return fg


def _expose_heatmap(html: str) -> str:
    """Expose the HeatmapControl instance as `window.__heatmapCtrl`.

    The minified control variable is unknown, so the last `<expr>.addTo(map);`
    (HeatmapControl mounts after LayerControl) is instrumented.
    """
    matches = list(re.finditer(r"([a-zA-Z0-9_$]+)\.addTo\(map\);", html))
    if matches:
        m = matches[-1]
        html = (
            html[: m.start()]
            + f"window.__heatmapCtrl = {m.group(1)};"
            + html[m.start() :]
        )
    return html


def _make_flip_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    # Polygon first: it is the first overlay row, so the style drawer opens on a
    # layer that actually has a fill row (the point group has no fill mode).
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    # The heatmap panel grows up from the bottom edge, so its scheme row is the
    # geometry the user reported (near the viewport bottom). The layer panel
    # keeps its default corner: at bottomleft its pinned style drawer runs off
    # the bottom edge and the trigger stops being clickable entirely.
    LayerControl(position="topright").add_to(m)
    HeatmapControl(position="bottomleft").add_to(m)
    html = _expose_heatmap(m.get_root().render())
    page, errors = make_browser_page(browser, tmp_path, html, "scheme_flip")
    return page, errors


def _flip_centre(page, selector: str) -> dict:
    return page.evaluate(
        "(sel) => { const r = document.querySelector(sel).getBoundingClientRect();"
        " return { x: r.left + r.width / 2, y: r.top + r.height / 2,"
        "  top: r.top, bottom: r.bottom, height: r.height }; }",
        selector,
    )


def _open_layer_list(page) -> dict:
    """Open the style drawer's by-value scheme list and measure it."""
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    # Open the polygon's row, not the first overlay row: the point group sorts
    # first and has no fill mode.
    opened = page.evaluate(snippet("LayerControl/dropdown_open_style_panel"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], f"the ramp mode did not settle: {ready}"
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )
    # Wait for the portal to be positioned and stable across a frame before
    # measuring. Reading the rect immediately after "attached" can observe a
    # pre-layout box, making the flip verdict disagree with the rule on timing.
    page.wait_for_function(_js("platform/wait_scheme_dropdown_settled"), timeout=5000)
    return page.evaluate(_js("platform/read_scheme_dropdown_placement"))


def _open_heatmap_list(page) -> dict:
    """Open the heatmap panel's scheme list and measure it."""
    expanded = page.evaluate(
        "() => document.querySelector('.foliplus-heatmap-ctrl')"
        ".classList.contains('foliplus-is-expanded')"
    )
    if not expanded:
        page.evaluate(_js("HeatmapControl/click_toggle_button"))
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
    page.wait_for_selector(
        ".foliplus-heatmap-scheme-bar", state="visible", timeout=5000
    )
    box = _flip_centre(page, ".foliplus-heatmap-scheme-bar")
    page.mouse.click(box["x"], box["y"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )
    # Same settle-wait as _open_layer_list: the portal must be positioned and
    # stable before measuring, or the flip verdict flakes on layout timing.
    page.wait_for_function(_js("platform/wait_scheme_dropdown_settled"), timeout=5000)
    return page.evaluate(_js("platform/read_scheme_dropdown_placement"))


def _close(page) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)


class TestSchemeDropdownFlipBrowser:
    """One flip rule, verified on both real consumers."""

    def test_both_consumers_flip_by_one_rule(self, browser, tmp_path):
        with use_page(_make_flip_page, browser, tmp_path) as (page, errors):
            sweep = [(900, 900), (900, 620), (900, 470), (900, 360)]
            samples: dict[str, list[dict]] = {"layer": [], "heatmap": []}
            for width, height in sweep:
                page.set_viewport_size({"width": width, "height": height})
                page.wait_for_timeout(150)
                samples["layer"].append(
                    _open_layer_list(page) | {"viewport": [width, height]}
                )
                _close(page)
                samples["heatmap"].append(
                    _open_heatmap_list(page) | {"viewport": [width, height]}
                )
                _close(page)

            for name, entries in samples.items():
                for sample in entries:
                    assert sample["ok"], (name, sample)
                    assert sample["portal"], (
                        f"{name}: the list is not portalled: {sample}"
                    )
                    assert sample["ruleHolds"], (
                        f"{name}: flip disagreed with the shared rule: {sample}"
                    )

            # The user-visible bug: one consumer flipped and the other never
            # did. Both must now flip at the same cramped viewport.
            both_flipped = [
                entries[0]["viewport"]
                for entries in zip(samples["layer"], samples["heatmap"])
                if entries[0]["flipped"] and entries[1]["flipped"]
            ]
            assert both_flipped, (
                "no viewport made both consumers flip: "
                f"{json.dumps(samples, indent=1)[:4000]}"
            )

            # A list whose content is taller than its box scrolls inside it
            # rather than growing past the viewport. (The tighter "the room on
            # the chosen side is itself shorter than the list" branch is covered
            # by the jsdom placement cases, where the geometry can be pinned to
            # the pixel; here the panels keep enough room for the 200 px cap.)
            assert all(
                sample["scrolls"] for entries in samples.values() for sample in entries
            ), f"a list did not scroll inside its cap: {samples}"
            assert not errors, f"JS errors: {errors}"

    def test_portal_list_keeps_the_shared_geometry_after_resize(
        self, browser, tmp_path
    ):
        """A resize re-places the portalled list.

        The picker listens for scroll/resize; a viewport shrink must move the
        list, not leave it at the old top.
        """
        with use_page(_make_flip_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": 900, "height": 900})
            page.wait_for_timeout(150)
            first = _open_layer_list(page)
            assert first["ok"], first
            page.set_viewport_size({"width": 900, "height": 420})
            page.wait_for_timeout(150)
            after = page.evaluate(_js("platform/read_scheme_dropdown_placement"))
            assert after["ok"], after
            assert after["ruleHolds"], after
            assert after["dropdown"]["top"] != first["dropdown"]["top"], (
                f"the list kept its old position after resize: {first} -> {after}"
            )
            _close(page)
            assert not errors, f"JS errors: {errors}"


def _make_close_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    HeatmapControl(position="bottomleft").add_to(m)
    html = _expose_heatmap(m.get_root().render())
    return make_browser_page(browser, tmp_path, html, "picker_close")


def _make_order_page(browser, tmp_path, layer_first: bool):
    """Build a page with LayerControl + HeatmapControl in a chosen order.

    Both controls share one map. Each registers a picker overlay entry on
    the shared per-map registry; the registration order decides which entry
    survives when both used the same id (the duplicate is rejected). This
    helper pins the order so the regression test can prove that the fix makes
    the outcome order-independent.
    """
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    if layer_first:
        LayerControl(position="topright").add_to(m)
        HeatmapControl(position="bottomleft").add_to(m)
    else:
        HeatmapControl(position="bottomleft").add_to(m)
        LayerControl(position="topright").add_to(m)
    html = _expose_heatmap(m.get_root().render())
    return make_browser_page(
        browser, tmp_path, html, "picker_close", prelude=_WARN_PRELUDE
    )


def _state(page) -> dict:
    return page.evaluate(_js("platform/read_picker_panel_state"))


def _wait_closed(page) -> None:
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="detached", timeout=3000
    )


def _close_centre(page, selector: str) -> dict:
    return page.evaluate(_js("platform/read_element_centre"), selector)


def _open_heatmap_dropdown(page) -> None:
    expanded = page.evaluate(_js("HeatmapControl/panel_is_open"))
    if not expanded:
        page.evaluate(_js("HeatmapControl/click_toggle_button"))
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        heatmap_ready(page)
    page.wait_for_selector(
        ".foliplus-heatmap-scheme-bar", state="visible", timeout=5000
    )
    box = _close_centre(page, ".foliplus-heatmap-scheme-bar")
    page.mouse.click(box["x"], box["y"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _open_style_dropdown(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel_polygon"))
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], f"the ramp mode did not settle: {ready}"
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    # Wait for the picker's open state to be *committed*, not merely for the
    # portal node to be in the DOM. On Linux headless the open state lands a
    # beat after the portal is attached (the dropdown is appended before the
    # trigger's aria-expanded and the row layout settle), and pressing Escape in
    # that window reads PICKER_DROPDOWN as not open, so the registry's topmost()
    # falls through to LAYER_STYLE and one press tears down both the list and
    # the drawer. Only the committed state guarantees the picker owns Escape.
    page.wait_for_function(_js("LayerControl/wait_picker_committed"), timeout=3000)


class TestPickerCloseBrowser:
    """One rule for both consumers: put the panel away, the list goes with it."""

    def test_heatmap_affordances_close_the_list(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            # The close button in the panel header.
            _open_heatmap_dropdown(page)
            page.evaluate(_js("HeatmapControl/click_close_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state

            # The clear button collapses the panel too, so it must close too.
            _open_heatmap_dropdown(page)
            page.evaluate(_js("HeatmapControl/click_clear_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state
            assert not errors, f"JS errors: {errors}"

    def test_heatmap_outside_press_closes_both(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            box = page.evaluate(_js("platform/read_map_centre"))
            page.mouse.click(box["x"], box["y"])
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["collapsed"], state
            assert not errors, f"JS errors: {errors}"

    def test_escape_closes_the_list_and_keeps_the_panel(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            page.keyboard.press("Escape")
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["heatmap"]["expanded"], state
            assert not errors, f"JS errors: {errors}"

    def test_collapse_in_pseudo_fullscreen_closes_the_list(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            entered = page.evaluate(_js("platform/set_pseudo_fullscreen"), True)
            assert entered["ok"], entered
            assert entered["pseudo"], entered
            _open_heatmap_dropdown(page)
            hosted = _state(page)
            assert hosted["hostClass"].find("leaflet-container") >= 0, hosted

            page.evaluate(_js("HeatmapControl/click_close_button"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            page.evaluate(_js("platform/set_pseudo_fullscreen"), False)
            assert not errors, f"JS errors: {errors}"

    def test_removing_the_control_closes_the_list(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            page.evaluate(_js("platform/remove_heatmap_control"))
            _wait_closed(page)
            assert not page.evaluate(_js("platform/has_heatmap_control"))
            assert not errors, f"JS errors: {errors}"

    def test_style_drawer_close_closes_the_list(self, browser, tmp_path):
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_style_dropdown(page)
            assert page.evaluate(_js("LayerControl/close_style_panel"))
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert not state["stylePanelOpen"], state
            assert not errors, f"JS errors: {errors}"

    def test_escape_in_the_style_drawer_closes_the_list_only(self, browser, tmp_path):
        """The picker owns Escape while its list is open: list out, drawer stays.

        The drawer's own Escape handler (row cursor / panel close) is downstream
        of the window-capture Escape the picker claims, so one press must close
        the list and leave the drawer in place for the next colour choice.
        """
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_style_dropdown(page)
            page.keyboard.press("Escape")
            _wait_closed(page)
            state = _state(page)
            assert state["portalCount"] == 0, state
            assert state["stylePanelOpen"], state
            assert state["styleDrawerVisible"], state
            assert not errors, f"JS errors: {errors}"

    def test_the_next_press_after_a_choice_still_lands(self, browser, tmp_path):
        """Choosing a scheme must not swallow the press that follows."""
        with use_page(_make_close_page, browser, tmp_path) as (page, errors):
            _open_heatmap_dropdown(page)
            rows = page.evaluate(_js("platform/read_scheme_dropdown_rows"))
            assert rows["ok"], rows
            page.mouse.click(rows["targetX"], rows["targetY"])
            _wait_closed(page)
            state = _state(page)
            assert state["heatmap"]["expanded"], state

            toggle = _close_centre(page, ".foliplus-heatmap-ctrl .foliplus-toggle-btn")
            page.mouse.click(toggle["x"], toggle["y"])
            page.wait_for_selector(
                ".foliplus-heatmap-ctrl.foliplus-is-collapsed",
                state="attached",
                timeout=3000,
            )
            assert not errors, f"JS errors: {errors}"

    def test_escape_in_style_drawer_ignores_a_second_picker_on_the_same_map(
        self, browser, tmp_path
    ):
        """One map, two picker-owning controls: Escape must close only the open list.

        Both LayerControl and HeatmapControl register a picker overlay entry on
        the shared per-map registry. Before the fix both used the same id, so the
        second registration was a duplicate and was rejected, leaving one control
        with no Escape-owning surface. With the style picker open, Escape must
        close the list and leave the style drawer in place — regardless of which
        control registered first. Both orders are exercised because the
        duplicate-winner depended on registration order.
        """
        for layer_first in (True, False):
            with use_page(
                lambda b, t: _make_order_page(b, t, layer_first), browser, tmp_path
            ) as (page, errors):
                # No duplicate overlay id may be logged during setup: the fix
                # namespaces the picker entry per consumer, so the two controls
                # never collide.
                _open_style_dropdown(page)
                page.keyboard.press("Escape")
                _wait_closed(page)
                state = _state(page)
                assert state["portalCount"] == 0, state
                assert state["stylePanelOpen"], state
                assert state["styleDrawerVisible"], state
                warns = page.evaluate(_js("LayerControl/read_setup_warns"))
                dup = [w for w in warns if "duplicate overlay id" in w]
                assert not dup, (
                    f"duplicate overlay id warning (layer_first={layer_first}): {dup}"
                )
                assert not errors, f"JS errors (layer_first={layer_first}): {errors}"


def _ramp_layer() -> folium.GeoJson:
    """A polygon layer with a numeric property, for the fill ramp mode."""
    return folium.GeoJson(
        json.dumps(load_geojson("common", "polygons_fuzhou_3offset")),
        name="Polygon data",
    )


def _layer_map(**ctrl_kwargs) -> folium.Map:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    LayerControl(**ctrl_kwargs).add_to(m)
    FullscreenControl(hide_self=True, hide_others=False).add_to(m)
    _ramp_layer().add_to(m)
    return m


def _make_host_page(browser, tmp_path, *, pseudo: bool):
    """Build the map page; `pseudo` disables the native API before scripts run.

    The API is disabled by an inline script in the rendered HTML, so the
    FullscreenControl's first `isEnabled` read takes the fallback branch — the
    same fixture shape the FullscreenControl pseudo tests use.
    """
    html = _layer_map().get_root().render()
    if pseudo:
        html = html.replace(
            "<body>",
            f"<body>\n        <script>\n          {snippet('common/fullscreen_stub').strip()}\n        </script>",
        )
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "scheme_host_pseudo" if pseudo else "scheme_host_native",
    )


def _open_ramp(page) -> None:
    """Expand the layer control, open the style drawer and settle the ramp mode."""
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
    assert ready["ok"], f"the ramp mode did not settle: {ready}"
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
        with use_page(_make_host_page, browser, tmp_path, pseudo=True) as (
            page,
            errors,
        ):
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
        with use_page(_make_host_page, browser, tmp_path, pseudo=False) as (
            page,
            errors,
        ):
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


@pytest.fixture(scope="module")
def scrollbar_browser(browser):
    """Chromium with real scrollbars: Playwright hides them by default.

    Launches a second Browser from the session fixture's own Playwright
    connection: one process owns one Playwright context, so a nested
    sync_playwright() would trip "Sync API inside the asyncio loop".
    """
    _prefetch_cdn_cache()
    with browser.browser_type.launch(
        headless=True, ignore_default_args=["--hide-scrollbars"]
    ) as real:
        yield _CdnBrowserProxy(real)


def _make_strip_page(browser, tmp_path, dpr: int, schemes: list[str] | None = None):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    _polygon_layer().add_to(m)
    _points_group().add_to(m)
    LayerControl(position="topright").add_to(m)
    heatmap = HeatmapControl(position="bottomleft")
    if schemes is not None:
        heatmap = HeatmapControl(position="bottomleft", schemes=schemes)
    heatmap.add_to(m)
    html = _expose_heatmap(m.get_root().render())
    html_path = tmp_path / f"scheme_strip_dpr{dpr}.html"
    html_path.write_text(html, encoding="utf-8")
    page = browser.new_page(
        viewport={"width": 1440, "height": 900}, device_scale_factor=dpr
    )
    errors: list[str] = []
    page.on(
        "console",
        lambda msg: (
            errors.append(msg.text)
            if msg.type == "error"
            and not msg.text.startswith("Failed to load resource")
            else None
        ),
    )
    page.goto(html_path.as_uri(), wait_until="domcontentloaded")
    return page, errors


def _open_strip_heatmap_list(page) -> None:
    if not page.evaluate(_js("HeatmapControl/panel_is_open")):
        page.evaluate(_js("HeatmapControl/click_toggle_button"))
        page.wait_for_selector(
            ".foliplus-heatmap-ctrl.foliplus-is-expanded",
            state="attached",
            timeout=5000,
        )
        heatmap_ready(page)
    options = page.evaluate(_js("HeatmapControl/read_layer_options"))
    assert options, "the heatmap offers no layer to select"
    page.evaluate(_js("HeatmapControl/select_layer"), options[0])
    page.wait_for_timeout(150)
    assert page.evaluate(_js("HeatmapControl/click_scheme_bar"))
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _open_strip_layer_list(page) -> None:
    page.evaluate(_js("LayerControl/open_panel"))
    page.wait_for_selector(
        ".foliplus-layer-ctrl.foliplus-is-expanded", state="attached", timeout=5000
    )
    panel_ready(page)
    opened = page.evaluate(_js("LayerControl/open_style_panel_polygon"))
    assert opened["ok"], opened
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], ready
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )


def _measure(page, trigger: str) -> dict:
    """Sample the strip geometry once the picker width has settled.

    The picker's dropdown is positioned with the trigger width at open, but the
    trigger can resize one frame later (a layout scrollbar lane disappears from
    the panel content when the picker portals out, widening the trigger). The
    dropdown follows via a ResizeObserver on the next animation frame, so a
    measurement taken immediately after the portal is attached can read a stale
    width (e.g. DPR2: dropdown 145 vs trigger 160) and fail for the wrong
    reason.

    Wait for the widths to agree before sampling. If they never settle (a
    genuine product bug), the wait resolves a diagnostics object instead of
    silently passing, and this fails loudly with the widths/lane evidence.
    """
    settled = page.evaluate(_js("platform/wait_scheme_picker_settled"), trigger)
    assert settled is True, f"picker width did not settle: {settled}"
    return page.evaluate(_js("platform/measure_scheme_strip"), trigger)


def _assert_invariant(sample: dict) -> None:
    """Strip right == min(padding-box right - inset, scrollport right).

    The true invariant: a row cannot paint into a classic scrollbar's gutter
    (it lies outside the scrollport), so the strip stops at the scrollport
    edge whenever the measured lane exceeds the inset, and sits on the
    trigger's strip edge otherwise. Both branches are one rule:

      strip right = min(paddingBoxRight - inset, scrollportRight)

    - lane <= inset (DPR1, ~15 <= inset): the strip aligns with the trigger bar.
    - lane > inset (DPR2, ~30 > inset): the strip clips at the scrollport,
      shorter than the trigger by (lane - inset) px — expected, not a bug.

    The strip's left edge always matches the trigger's.
    """
    assert sample["ok"], sample
    trigger = sample["triggerBar"]
    assert sample["itemBars"], sample
    # The strip inset read from the DOM (--foliplus-scheme-picker-bar-inset-x)
    # rather than hardcoded, so the invariant tracks a consumer override too.
    inset = sample["itemInset"]
    expected_right = min(sample["paddingBoxRight"] - inset, sample["scrollportRight"])
    for bar in sample["itemBars"]:
        # The whole sample rides on the message: a mismatch is a geometry bug,
        # and the lane/width diagnostics are what identify its cause.
        assert abs(bar["left"] - trigger["left"]) <= 1, (bar, trigger, sample)
        assert abs(bar["right"] - expected_right) <= 1, (bar, trigger, sample)
        assert abs(bar["width"] - (expected_right - bar["left"])) <= 1, (
            bar,
            trigger,
            sample,
        )


class TestSchemeStripAlignmentBrowser:
    """One strip geometry for the trigger and every list row, both states."""

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_heatmap_strips_match_with_a_layout_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        with use_page(_make_strip_page, scrollbar_browser, tmp_path, dpr) as (
            page,
            errors,
        ):
            _open_strip_heatmap_list(page)
            sample = _measure(page, HEATMAP_TRIGGER)
            assert sample["lane"] >= 1, f"real scrollbar lane missing: {sample}"
            assert sample["scrollable"], sample
            _assert_invariant(sample)
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_heatmap_strips_clip_at_the_scrollport_when_lane_exceeds_inset(
        self, scrollbar_browser, tmp_path, dpr
    ):
        """A gutter wider than the inset clips the strip at the scrollport.

        The classic scrollbar's lane is ~15px at DPR1 and ~30px at DPR2; the
        item inset is 18px, so only DPR2 (and a real scrollbar) reliably
        exceeds it. This asserts the true invariant: the strip stops at the
        scrollport right edge, shorter than the trigger by (lane - inset).
        """
        with use_page(_make_strip_page, scrollbar_browser, tmp_path, dpr) as (
            page,
            errors,
        ):
            _open_strip_heatmap_list(page)
            sample = _measure(page, HEATMAP_TRIGGER)
            assert sample["lane"] >= 1, f"real scrollbar lane missing: {sample}"
            assert sample["scrollable"], sample
            _assert_invariant(sample)
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_heatmap_strips_match_without_a_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        with use_page(
            _make_strip_page, scrollbar_browser, tmp_path, dpr, FITTING_SCHEMES
        ) as (page, errors):
            _open_strip_heatmap_list(page)
            sample = _measure(page, HEATMAP_TRIGGER)
            assert not sample["scrollable"], sample
            _assert_invariant(sample)
            assert not errors, f"JS errors: {errors}"

    @pytest.mark.parametrize("dpr", [1, 2])
    def test_style_drawer_strips_match_with_a_layout_scrollbar(
        self, scrollbar_browser, tmp_path, dpr
    ):
        with use_page(_make_strip_page, scrollbar_browser, tmp_path, dpr) as (
            page,
            errors,
        ):
            _open_strip_layer_list(page)
            sample = _measure(page, LAYER_TRIGGER)
            assert sample["lane"] >= 1, f"real scrollbar lane missing: {sample}"
            _assert_invariant(sample)
            assert not errors, f"JS errors: {errors}"
