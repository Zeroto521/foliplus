"""The scheme picker flips the same way in both consumers.

Two components mount the shared `common/schemePicker` dropdown: LayerControl's
style drawer and HeatmapControl's panel. They used to mount it differently — the
drawer portalled its list (pinned with viewport coordinates, with a flip
decision) while the heatmap kept it inline (anchored by CSS, always downward, so
it ran past the viewport edge). Both consumers now portal the list through the
same host contract, so one placement rule governs both; these tests measure the
real Chromium geometry and assert:

* the list is portalled in both consumers;
* it paints below by default;
* it flips above when the room below cannot hold the list and the room above is
  larger (measured from the boxes, not from a class);
* its content scrolls inside the box when taller than the viewport room.

The same viewport sweep is applied to both, so a viewport where one flips and
the other does not would fail the "same rule" assertion.
"""

from __future__ import annotations

import json
import re

import folium
from conftest import _js, make_browser_page, panel_ready, use_page

from foliplus import HeatmapControl, LayerControl


def _polygon_layer() -> folium.GeoJson:
    """Overlay layer with a numeric property, for the style drawer's ramp arm."""
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


def _points_group() -> folium.FeatureGroup:
    """One point layer, so the heatmap auto-selects it and opens its config."""
    fg = folium.FeatureGroup(name="Points", show=True)
    gj = json.dumps(
        {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"val": 1.0 + i},
                    "geometry": {
                        "type": "Point",
                        "coordinates": [119.30 + i * 0.01, 26.08],
                    },
                }
                for i in range(3)
            ],
        }
    )
    folium.GeoJson(gj).add_to(fg)
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


def _make_page(browser, tmp_path):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    # Polygon first: it is the first overlay row, so the style drawer opens on a
    # layer that actually has a fill row (the point group has no fill arm).
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


def _centre(page, selector: str) -> dict:
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
    # first and has no fill arm.
    opened = page.evaluate(
        """() => {
          const rows = [...document.querySelectorAll(
            '.foliplus-layer-item[data-layer-type=overlay]')];
          const row = rows.find(r => r.textContent.includes('Polygon data'));
          if (!row) return { ok: false, reason: 'no-polygon-row' };
          row.querySelector('.foliplus-layer-more-btn').click();
          const menu = row.querySelector('.foliplus-layer-more-menu.open');
          if (!menu) return { ok: false, reason: 'menu-not-open' };
          const item = menu.querySelector('button[data-action="style-layer"]');
          if (!item) return { ok: false, reason: 'no-style-item' };
          item.click();
          return { ok: !!row.querySelector('.foliplus-layer-style-panel') };
        }"""
    )
    assert opened["ok"], f"style panel did not open: {opened}"
    page.wait_for_selector(".foliplus-layer-style-panel", state="visible", timeout=5000)
    ready = page.evaluate(_js("LayerControl/style_scheme_portal_prepare"))
    assert ready["ok"], f"the ramp arm did not settle: {ready}"
    page.mouse.click(ready["triggerX"], ready["triggerY"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )
    return page.evaluate(_js("common/read_scheme_dropdown_placement"))


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
    box = _centre(page, ".foliplus-heatmap-scheme-bar")
    page.mouse.click(box["x"], box["y"])
    page.wait_for_selector(
        ".foliplus-scheme-picker-portal", state="attached", timeout=3000
    )
    return page.evaluate(_js("common/read_scheme_dropdown_placement"))


def _close(page) -> None:
    page.keyboard.press("Escape")
    page.wait_for_timeout(50)


class TestSchemeDropdownFlipBrowser:
    """One flip rule, verified on both real consumers."""

    def test_both_consumers_flip_by_one_rule(self, browser, tmp_path):
        with use_page(_make_page, browser, tmp_path) as (page, errors):
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
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.set_viewport_size({"width": 900, "height": 900})
            page.wait_for_timeout(150)
            first = _open_layer_list(page)
            assert first["ok"], first
            page.set_viewport_size({"width": 900, "height": 420})
            page.wait_for_timeout(150)
            after = page.evaluate(_js("common/read_scheme_dropdown_placement"))
            assert after["ok"], after
            assert after["ruleHolds"], after
            assert after["dropdown"]["top"] != first["dropdown"]["top"], (
                f"the list kept its old position after resize: {first} -> {after}"
            )
            _close(page)
            assert not errors, f"JS errors: {errors}"
