"""Contract: folium camelizes every Icon option key at render time.

folium's Icon builds a Python dict with snake_case keys (marker_color,
icon_color), but folium/template.py renders each option key through
camelize() before emitting it into the Leaflet call (folium/utilities.py
camelize). So the JS runtime receives camelCase keys (markerColor, iconColor)
and has done so in every folium release we target (0.20.0 and 1.0.0 both
camelize).

foliplus's JS icon reads depend on this fact: the camelCase spelling is the
live channel, and the snake spelling accepted by the markerIcon/paint reads
is a defensive fallback for hand-built Leaflet icons and a guard should
folium ever stop camelizing. This test pins the render contract that makes
that reading correct; if folium changes behaviour and this test goes red,
the snake fallback becomes load-bearing and the JS comments should be
revisited.
"""

from __future__ import annotations

import folium
from conftest import render


def test_folium_icon_camelizes_option_keys_at_render() -> None:
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    folium.Marker(
        [26.08, 119.30],
        icon=folium.Icon(color="red", icon_color="white"),
    ).add_to(m)
    html = render(m)

    # The rendered Leaflet call carries camelCase keys.
    assert '"markerColor": "red"' in html
    assert '"iconColor": "white"' in html

    # No snake_case spelling reaches the browser — camelize() already ran.
    assert '"marker_color"' not in html
    assert '"icon_color"' not in html
    assert '"marker_color_opacity"' not in html
    assert '"markerColorOpacity"' not in html
