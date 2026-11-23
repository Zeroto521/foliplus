import folium

from foliplus import LayerControl

m = folium.Map(location=[24.48, 118.09], zoom_start=11, tiles="OpenStreetMap")

fg = folium.FeatureGroup(name="Facility Group")
for i, (lat, lon) in enumerate([(24.45, 118.05), (24.50, 118.12), (24.55, 118.08)]):
    folium.CircleMarker(
        [lat, lon],
        radius=8,
        color="#e74c3c",
        fill=True,
        fillColor="#e74c3c",
        fillOpacity=0.7,
        popup=f"facility {i}",
    ).add_to(fg)
fg.add_to(m)

rg = folium.FeatureGroup(name="Route Group")
folium.PolyLine([[24.45, 118.05], [24.50, 118.12]], color="#2980b9", weight=4).add_to(
    rg
)
folium.PolyLine([[24.50, 118.12], [24.55, 118.08]], color="#2980b9", weight=4).add_to(
    rg
)
rg.add_to(m)

folium.Marker([24.47, 118.10], popup="standalone marker", tooltip="Standalone").add_to(
    m
)
folium.CircleMarker(
    [24.52, 118.15],
    radius=10,
    color="#27ae60",
    fill=True,
    fillColor="#27ae60",
    fillOpacity=0.6,
    popup="standalone circle",
).add_to(m)

LayerControl(locale="zh").add_to(m)

out = ".foliplus/demo/container-expand-acceptance.html"
m.save(out)
print("saved", out)
