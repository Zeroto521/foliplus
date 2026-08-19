# foliplus

[![PyPI Version](https://img.shields.io/pypi/v/foliplus)](https://pypi.org/project/foliplus/)
[![Python Versions](https://img.shields.io/pypi/pyversions/foliplus)](https://pypi.org/project/foliplus/)
[![Test Status](https://github.com/Zeroto521/foliplus/actions/workflows/test.yaml/badge.svg)](https://github.com/Zeroto521/foliplus/actions/workflows/test.yaml)
[![Coverage Status](https://codecov.io/gh/Zeroto521/foliplus/branch/main/graph/badge.svg)](https://codecov.io/gh/Zeroto521/foliplus)

**foliplus turns a web map into something you can actually work. It brings GIS desktop tools to the browser.**

From GeoPandas handling spatial data, to Folium rendering the map, to foliplus providing the full interactive layer—foliplus fills the missing piece: **letting users interact with the map, not just look at it.**

## Capabilities

| Component                | Description                                                                           |
|:-------------------------|:--------------------------------------------------------------------------------------|
| 📷 **ExportControl**     | Capture a specific area of the map and export it as an image                          |
| 🖥 **FullscreenControl** | Fullscreen toggle with auto-hide for other controls                                   |
| 🔥 **HeatmapControl**    | H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons                  |
| 🗂 **LayerControl**      | Drag-and-drop layer ordering with geometry icons, color picker, and panes             |
| 🎯 **LocateControl**     | Fly to the user's current position                                                    |
| 📏 **MeasureControl**    | Distance measurement, area measurement, circle drawing, and GPS marker with geocoding |
| 📐 **ScaleControl**      | Scale bar with metric or imperial units and optional zoom level display               |
| 🔍 **SearchControl**     | Coordinate and address search via Nominatim reverse geocoding                         |

## Quick Start

```bash
pip install foliplus
```

```python
import folium
import foliplus

m = folium.Map(location=[31.23, 121.47], zoom_start=12)

foliplus.SearchControl().add_to(m)
foliplus.LayerControl().add_to(m)
foliplus.HeatmapControl().add_to(m)
foliplus.ScaleControl().add_to(m)
foliplus.MeasureControl().add_to(m)
foliplus.ExportControl().add_to(m)

m.save("map.html")
# Then open map.html in a browser to interact with the map
```

## How Components Work Together

Every component in foliplus registers its canvas or layer through **LayerControl**, which manages z-order, visibility, and lifecycle centrally. This means all tools share a single layer stack—no z-index clashes, no orphaned DOM elements.

On top of this shared layer foundation, tools coordinate further:

- While **measuring**, search and locate are blocked to prevent map interaction conflicts
- During **export**, measurement pauses, heatmap renders in full resolution, and layer order is synced for a complete screenshot
- When a layer is **deleted** from the layer panel, the component that owns it (e.g. measurement) auto-cleans its state
- When layers change, the heatmap refreshes automatically

All of this happens without manual wiring—the framework handles it internally.

## Why This Is Not a Collection of Plugins

Traditional map component libraries treat each tool as an independent plugin. foliplus was designed as a **platform** from the start:

- Components **communicate** with each other, instead of working in isolation
- Layers are **managed centrally**, instead of each tool creating its own DOM
- Conflicts are **resolved automatically**, instead of tools interfering with each other
- Third-party components can **plug into** the system, instead of being locked out
