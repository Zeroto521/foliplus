import webbrowser
from pathlib import Path

import dtoolkit.geoaccessor  # noqa: F401
import folium
import geopandas as gpd
import numpy as np
import pandas as pd

from foliplus import (
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)

# ---------------------------------------------------------------------------
# 1. Load & Refine Administrative Boundaries
# ---------------------------------------------------------------------------
# Load the Shanghai district boundaries
boundary = gpd.read_file("doc/source/data/gadm41_CHN_3_Shanghai.geojson")

# Calculate District Centers (Layer 1)
# Re-project to EPSG:3857 for accurate geometry centers, then back to EPSG:4326 for Folium
districts = boundary.copy()
districts["geometry"] = boundary.to_crs(3857).centroid.to_crs(4326)

# Inject simulated demographic data for visualization
np.random.seed(42)
districts["population_density"] = np.random.randint(5_000, 30_000, len(districts))

# ---------------------------------------------------------------------------
# 2. Vectorized Point Sampling (Layer 2)
# ---------------------------------------------------------------------------
bounds = boundary.total_bounds
facilities = (
    # Generate a dense candidate pool across the city
    pd.DataFrame(
        {
            "x": np.random.uniform(bounds[0], bounds[2], 5_000),
            "y": np.random.uniform(bounds[1], bounds[3], 5_000),
            "score": np.random.randint(1, 5_000, 5_000),
        }
    )
    .from_xy("x", "y", crs=4326)
    # Perform spatial join to keep only points inside the land area
    .sjoin(boundary, how="inner")
    .groupby("NAME_3")
    .sample(n=500, random_state=42, replace=True)
    .reset_index(drop=True)
)

# ---------------------------------------------------------------------------
# 3. Initialize Base Map
# ---------------------------------------------------------------------------
center = districts.geocentroid()
m = folium.Map(location=[center.y, center.x], zoom_start=10, tiles=None)

# Add professional base themes
folium.TileLayer("CartoDB positron", name="Light Canvas").add_to(m)
folium.TileLayer("CartoDB dark_matter", name="Dark Mode", show=False).add_to(m)

# ---------------------------------------------------------------------------
# 4. Layer Orchestration
# ---------------------------------------------------------------------------
# Step 1: Add District Landmarks (Top markers)
districts.explore(
    m=m,
    name="a very long long long long name: District Landmarks",
    marker_type="marker",
    marker_kwds={"icon": folium.Icon(color="cadetblue", icon="map-pin", prefix="fa")},
    tooltip="NAME_3",
    popup=["NAME_3", "population_density"],
    legend=False,
)

# Step 2: Add Facility Points (Heatmap source)
facilities.explore(
    m=m,
    name="Facility Points",
    column="score",
    cmap="plasma",
    marker_type="circle_marker",
    style_kwds={"radius": 3, "fillOpacity": 0.8, "stroke": False},
    legend=True,
    show=True,
)

# Step 3: Add Administrative Polygons as the base overlay
boundary.explore(
    m=m,
    name="Municipal Boundaries",
    color="gray",
    style_kwds={"fillOpacity": 0.30, "weight": 1.5, "dashArray": "5, 5"},
    tooltip="NAME_3",
    popup=True,
    legend=False,
)

# Step 4: Add Empty Layer (EMPTY icon test)
folium.FeatureGroup(name="Empty Layer", show=True).add_to(m)

# Step 5: Add Unknown Geometry Layer (UNKNOWN icon test)
folium.GeoJson(
    {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"note": "mixed geometry types"},
                "geometry": {
                    "type": "GeometryCollection",
                    "geometries": [
                        {"type": "Point", "coordinates": [121.47, 31.23]},
                        {
                            "type": "LineString",
                            "coordinates": [[121.48, 31.24], [121.49, 31.25]],
                        },
                        {
                            "type": "Polygon",
                            "coordinates": [
                                [
                                    [121.50, 31.26],
                                    [121.51, 31.27],
                                    [121.52, 31.26],
                                    [121.50, 31.26],
                                ]
                            ],
                        },
                    ],
                },
            }
        ],
    },
    name="Unknown Layer",
    show=True,
).add_to(m)

# ---------------------------------------------------------------------------
# Step 6: Add Commuting Routes (Line layer via to_line)
# ---------------------------------------------------------------------------
# Create a simulated route network connecting district centers
# to_line creates LineString geometries from (x1,y1) → (x2,y2) columns
(
    pd.DataFrame(
        {
            "x1": districts.geometry.x[::2].values,
            "y1": districts.geometry.y[::2].values,
            "x2": districts.geometry.x[1::2].values,
            "y2": districts.geometry.y[1::2].values,
            "route_name": [f"Route {i}" for i in range(len(districts.geometry.x[::2]))],
        }
    )
    .to_line("x1", "y1", "x2", "y2")
    .explore(
        m=m,
        name="Commuting Routes",
        color="#e74c3c",
        style_kwds={"weight": 6, "opacity": 0.9, "dashArray": "10 10"},
        highlight_kwds={"weight": 8},
        tooltip="route_name",
        legend=False,
        show=True,
    )
)


print("🌍 Map is added")


# Add all plugins with default settings to keep it simple but powerful
SearchControl().add_to(m)
LayerControl().add_to(m)
HeatmapControl(agg="sum").add_to(m)
ScaleControl().add_to(m)
MeasureControl().add_to(m)
ExportControl().add_to(m)
FullscreenControl(hide_self=False, hide_others=False).add_to(m)
LocateControl().add_to(m)

print("📦 foliplus's plugins are added")

file = "map.html"
m.save(file)
print(f"✅ Saved: {file}")
webbrowser.open("file:///" + Path(file).absolute().as_posix())
