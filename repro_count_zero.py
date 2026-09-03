"""Repro: multiple-layer group of plain folium.Markers, plus a heatmap layer.
Watch the LayerControl count column (plain Markers) and the heatmap behavior."""

import folium

from foliplus import HeatmapControl, LayerControl

m = folium.Map(location=[26.08, 119.30], zoom_start=12)
LayerControl().add_to(m)
HeatmapControl().add_to(m)

for i, name in enumerate(["Alpha", "Beta", "Gamma", "Delta"]):
    fg = folium.FeatureGroup(name=name, overlay=True, show=True)
    folium.Marker([26.08 + i * 0.01, 119.30 + i * 0.01], popup=name).add_to(fg)
    fg.add_to(m)

html = m.get_root().render()
out = "repro_count_zero.html"
with open(out, "w", encoding="utf-8") as f:
    f.write(html)
print(f"wrote {out}, {len(html)} bytes")
