"""Temporary probe: computed rail/glow of a member row vs a root row."""

from __future__ import annotations

import json

import folium
from conftest import _js, load_geojson, make_browser_page, use_page

from foliplus import LayerControl

from ..helper_browser import LayerControlBrowserBase

_POINT = json.dumps(load_geojson("LayerControl", "point_11934_2611"))


class TestProbeMemberParity(LayerControlBrowserBase):
    def test_probe(self, browser, tmp_path):
        group = folium.FeatureGroup(name="Folder A")
        for name in ("Member 1", "Member 2"):
            folium.GeoJson(_POINT, name=name).add_to(group)
        root = folium.GeoJson(_POINT, name="Root layer")
        with use_page(self._make_page, browser, tmp_path, group, root, slug="probe_member") as (page, errors):
            page.wait_for_timeout(400)
            rows = page.evaluate("""() => {
              const out = [];
              document.querySelectorAll('.foliplus-layer-ctrl [data-layer-id], .foliplus-layer-ctrl .foliplus-layer-item-folder').forEach(el => {
                const cs = getComputedStyle(el);
                out.push({
                  cls: el.className,
                  id: el.getAttribute('data-layer-id'),
                  folderKey: el.getAttribute('data-folder-key'),
                  active: el.classList.contains('foliplus-active'),
                  borderLeftColor: cs.borderLeftColor,
                  borderLeftWidth: cs.borderLeftWidth,
                  boxShadow: cs.boxShadow,
                  bg: cs.backgroundColor,
                  marginLeft: cs.marginLeft,
                  paddingLeft: cs.paddingLeft,
                });
              });
              return out;
            }""")
            print("ROWS=" + json.dumps(rows, indent=1))
            # hover the first member row
            page.evaluate("""() => {
              const el = document.querySelectorAll('.foliplus-layer-ctrl .foliplus-layer-item')[1];
              el.dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
            }""")
            page.wait_for_timeout(150)
            hovered = page.evaluate("""() => {
              const els = [...document.querySelectorAll('.foliplus-layer-ctrl .foliplus-layer-item')];
              return els.map(el => ({cls: el.className.slice(0, 60), shadow: getComputedStyle(el).boxShadow, bl: getComputedStyle(el).borderLeftColor}));
            }""")
            print("HOVER=" + json.dumps(hovered, indent=1))
