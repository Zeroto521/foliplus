"""Heatmap panel: its five dropdowns open above the panel and commit a pick.

Regression guard for #793. The shared dropdown portals its list out of the
panel; two defects made the five controls look dead on a real device while
every other test stayed green:

1. The portalled list carried no z-index, so an expanded panel (its
   .leaflet-bottom section is raised to base+9 = 9999) painted over it: the
   trigger took focus and the listbox never appeared. The list must be
   hit-testable at its own centre.
2. A press on a row was classified "outside" by the panel's dismiss binding
   (bindOutsideCollapse only sampled container.contains), so the panel
   collapsed under the click and the pick was lost.

Both assertions need a real browser: jsdom has no layout, no stacking order and
no elementFromPoint.
"""

from __future__ import annotations

import json

import folium
from conftest import _js, make_browser_page, use_page

from foliplus import FullscreenControl, HeatmapControl, LayerControl

# Every visible trigger in the panel, in DOM order, with the geometry a real
# click needs. Re-read before each click: the panel reflows as rows appear.
TRIGGERS = """() => {
  const ctrl = document.querySelector('.foliplus-heatmap-ctrl');
  return [...ctrl.querySelectorAll('.foliplus-dropdown-trigger')].map((el, i) => {
    const r = el.getBoundingClientRect();
    const row = el.closest('.foliplus-form-row');
    return {
      i,
      name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      hidden: row ? !!row.closest('.foliplus-hidden') : false,
    };
  });
}"""

# The five migrated controls, named by the bridged select they replaced. Row
# sets change as values change (a numeric aggregation shows the Field row), so
# each control is located through its own select instead of by a captured DOM
# index, and the ones whose pick hides a row run last.
CONTROLS = [
    ("Layer", "select[data-heatmap-layer]"),
    ("Field", "select[data-heatmap-field-select]"),
    ("Method", "select[data-heatmap-method]"),
    ("Classes", "select[data-heatmap-class-count]"),
    ("Aggregation", "select[data-heatmap-agg]"),
]

TRIGGER_AT = """(selector) => {
  const select = document.querySelector('.foliplus-heatmap-ctrl ' + selector);
  const row = select ? select.closest('.foliplus-form-row') : null;
  const el = row ? row.querySelector('.foliplus-dropdown-trigger') : null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
    x: Math.round(r.left + r.width / 2),
    y: Math.round(r.top + r.height / 2),
    expanded: el.getAttribute('aria-expanded'),
  };
}"""

OPEN = """() => {
  const list = [...document.querySelectorAll('.foliplus-dropdown-list')].find(l => !l.hidden);
  if (!list) return { open: 0 };
  const r = list.getBoundingClientRect();
  const top = document.elementsFromPoint(
    Math.round(r.left + r.width / 2),
    Math.round(r.top + r.height / 2),
  )[0] || null;
  const option = list.querySelector('.foliplus-dropdown-option:not([disabled])');
  const or = option ? option.getBoundingClientRect() : null;
  return {
    open: 1,
    rect: [Math.round(r.width), Math.round(r.height)],
    zIndex: getComputedStyle(list).zIndex,
    topIsInsideList: top ? list.contains(top) : false,
    topTag: top ? top.tagName.toLowerCase() + '.' + String(top.className || '').slice(0, 40) : null,
    option: option
      ? {
          label: (option.textContent || '').trim(),
          x: Math.round(or.left + or.width / 2),
          y: Math.round(or.top + or.height / 2),
        }
      : null,
  };
}"""

AFTER_PICK = """() => {
  const ctrl = document.querySelector('.foliplus-heatmap-ctrl');
  return {
    panelExpanded: ctrl.classList.contains('foliplus-is-expanded'),
    openLists: [...document.querySelectorAll('.foliplus-dropdown-list')].filter(l => !l.hidden).length,
    changes: window.__changes || [],
  };
}"""


def _stub_native_fullscreen(html: str) -> str:
    """Disable the Fullscreen API before the page's scripts run, so
    FullscreenControl takes its pseudo-fullscreen fallback."""
    return html.replace(
        "<body>",
        """<body>
        <script>
          Object.defineProperty(document, 'fullscreenEnabled', {
            value: false, configurable: true,
          });
          document.exitFullscreen = undefined;
          document.documentElement.requestFullscreen = undefined;
        </script>""",
    )


def _make_page(browser, tmp_path, *, pseudo: bool = False):
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    for i, (lat, lng) in enumerate([(26.08, 119.30), (26.09, 119.31), (26.07, 119.29)]):
        fg = folium.FeatureGroup(name=f"Points {i}", show=True)
        features = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "properties": {"val": lat},
                    "geometry": {"type": "Point", "coordinates": [lng, lat]},
                }
            ],
        }
        folium.GeoJson(json.dumps(features)).add_to(fg)
        fg.add_to(m)
    LayerControl().add_to(m)
    HeatmapControl().add_to(m)
    FullscreenControl(hide_self=True, hide_others=False).add_to(m)
    html = m.get_root().render()
    if pseudo:
        html = _stub_native_fullscreen(html)
    return make_browser_page(
        browser,
        tmp_path,
        html,
        "heatmap_dropdown_pseudo" if pseudo else "heatmap_dropdown",
    )


def _hexbin_panel_ready(page) -> None:
    """Expand the panel and put it in the aggregation state the user reported:
    one layer selected, numeric aggregation, so all five controls are visible."""
    page.wait_for_selector(".foliplus-heatmap-ctrl", state="attached", timeout=10000)
    page.evaluate(_js("HeatmapControl/click_toggle_button"))
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl.foliplus-is-expanded", state="attached"
    )
    page.evaluate(
        """() => {
          window.__changes = [];
          const ctrl = document.querySelector('.foliplus-heatmap-ctrl');
          ['layer', 'agg'].forEach(key => {
            const select = ctrl.querySelector('select[data-heatmap-' + key + ']');
            if (select) {
              select.addEventListener('change', event => {
                window.__changes.push({ key, value: select.value, bubbles: event.bubbles });
              });
            }
          });
          const layer = ctrl.querySelector('select[data-heatmap-layer]');
          layer.value = [...layer.options].find(option => option.value).value;
          layer.dispatchEvent(new Event('change', { bubbles: true }));
        }"""
    )
    page.wait_for_timeout(400)
    page.evaluate(
        """() => {
          const agg = document.querySelector('.foliplus-heatmap-ctrl select[data-heatmap-agg]');
          agg.value = 'sum';
          agg.dispatchEvent(new Event('change', { bubbles: true }));
        }"""
    )
    page.wait_for_timeout(400)


class TestHeatmapDropdownPanelBrowser:
    def test_five_dropdowns_open_above_the_panel_and_commit(self, browser, tmp_path):
        """Each of the five controls: popup on top, a real pick writes through
        the bridged select, and the panel is still open afterwards."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)
            triggers = page.evaluate(TRIGGERS)
            assert len(triggers) == 5, triggers

            seen: set[str] = set()
            for label, selector in CONTROLS:
                # Re-read the trigger before each press: earlier picks change the
                # row set, so coordinates captured earlier can be stale.
                trigger = page.evaluate(TRIGGER_AT, selector)
                assert trigger, f"{label}: no trigger in its row"
                seen.add(label)
                page.mouse.click(trigger["x"], trigger["y"])
                page.wait_for_timeout(180)

                opened = page.evaluate(OPEN)
                assert opened["open"] == 1, (
                    f"{trigger['name']}: the popup did not open ({opened})"
                )
                assert int(opened["zIndex"] or 0) > 9999, (
                    f"{trigger['name']}: the portalled list must outrank an "
                    f"expanded panel's section (9999), got z-index "
                    f"{opened['zIndex']!r}"
                )
                assert opened["topIsInsideList"], (
                    f"{trigger['name']}: the list's own centre resolves to "
                    f"{opened['topTag']} — the panel paints over the popup"
                )
                assert opened["option"], f"{trigger['name']}: no enabled row"

                page.mouse.click(opened["option"]["x"], opened["option"]["y"])
                page.wait_for_timeout(220)
                after = page.evaluate(AFTER_PICK)
                assert after["panelExpanded"], (
                    f"{trigger['name']}: picking a row collapsed the panel"
                )
                assert after["openLists"] == 0, after
                assert after["changes"], (
                    f"{trigger['name']}: the pick did not write through the "
                    "bridged select"
                )
                assert all(change["bubbles"] for change in after["changes"]), after
            assert seen == {label for label, _ in CONTROLS}, seen
            assert not errors, f"JS errors: {errors}"

    def test_tab_leaves_the_popup_from_the_control(self, browser, tmp_path):
        """Tab hands focus to the next control, not back to the top of the page.

        The focused row lives in the portalled popup; hiding it with the popup
        would drop focus on <body>, and the next Tab would restart at the first
        focusable element of the document. The popup returns focus to its
        trigger before closing so the browser's own Tab continues from there.
        """
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            _hexbin_panel_ready(page)
            trigger = page.evaluate(TRIGGER_AT, "select[data-heatmap-layer]")
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(150)
            page.keyboard.press("ArrowDown")
            page.wait_for_timeout(120)
            where = page.evaluate(
                """() => ({
                  insidePopup: !!document.activeElement.closest('.foliplus-dropdown-list'),
                })"""
            )
            assert where["insidePopup"], where

            page.keyboard.press("Tab")
            page.wait_for_timeout(150)
            after = page.evaluate(
                """() => {
                  const active = document.activeElement;
                  const agg = document.querySelector(
                    '.foliplus-heatmap-ctrl select[data-heatmap-agg]'
                  );
                  const aggTrigger = agg.closest('.foliplus-form-row')
                    .querySelector('.foliplus-dropdown-trigger');
                  return {
                    onBody: active === document.body,
                    onAggTrigger: active === aggTrigger,
                    openLists: [...document.querySelectorAll('.foliplus-dropdown-list')]
                      .filter(list => !list.hidden).length,
                  };
                }"""
            )
            assert after["openLists"] == 0, after
            assert not after["onBody"], (
                "Tab left focus on <body>; the next Tab would restart from the "
                "top of the page"
            )
            assert after["onAggTrigger"], (
                f"Tab did not continue from the control, focus is {after}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_pseudo_fullscreen_keeps_the_popup_on_the_covering_surface(
        self, browser, tmp_path
    ):
        """In the pseudo-fullscreen fallback the list mounts inside the
        covering container; on <body> the opaque map would paint over it."""
        with use_page(_make_page, browser, tmp_path, pseudo=True) as (page, errors):
            page.wait_for_selector(".foliplus-fullscreen-toggle", state="attached")
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(_js("FullscreenControl/read_pseudo_fullscreen_on"))
            _hexbin_panel_ready(page)

            trigger = page.evaluate(TRIGGER_AT, "select[data-heatmap-layer]")
            assert trigger, "the layer trigger is missing"
            page.mouse.click(trigger["x"], trigger["y"])
            page.wait_for_timeout(200)
            opened = page.evaluate(OPEN)
            assert opened["open"] == 1, opened
            assert opened["topIsInsideList"], (
                "the popup must stay above the opaque pseudo-fullscreen map, "
                f"the centre resolves to {opened['topTag']}"
            )
            host = page.evaluate(
                """() => {
                  const list = [...document.querySelectorAll('.foliplus-dropdown-list')]
                    .find(l => !l.hidden);
                  if (!list) return null;
                  const host = list.parentElement;
                  const container = document.querySelector('.leaflet-container');
                  return {
                    hostClass: String(host.className),
                    hostIsContainer: host === container,
                    pseudoActive: container.classList.contains('leaflet-pseudo-fullscreen'),
                  };
                }"""
            )
            assert host["pseudoActive"], host
            assert host["hostIsContainer"], (
                f"the list must mount in the pseudo-fullscreen container, got "
                f"{host['hostClass']!r}"
            )
            assert not errors, f"JS errors: {errors}"
