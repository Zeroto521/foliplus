<p align="center">
  <a href="https://foliplus.readthedocs.io">foliplus</a>
</p>

<p align="center">
  <a href="https://foliplus.readthedocs.io/en/latest/quickstart.html#display-map"><img src="doc/source/_static/preview.png" alt="Preview"></a>
</p>

<p align="center">
  <em>foliplus: the missing piece between "see the map" and "use the map." GeoPandas handles data, Folium renders it, foliplus brings it to life.</em>
</p>

<p align="center">
  <a href="https://pypi.org/project/foliplus">
      <img src="https://img.shields.io/pypi/v/foliplus?color=%2334D058" alt="Package Version">
  </a>
  <a href="https://pypi.org/project/foliplus">
      <img src="https://img.shields.io/pypi/pyversions/foliplus.svg?color=%2334D058" alt="Supported Python">
  </a>
  <a href="https://github.com/Zeroto521/foliplus/actions/workflows/test.yaml">
      <img src="https://github.com/Zeroto521/foliplus/actions/workflows/test.yaml/badge.svg" alt="Tests">
  </a>
  <a href="https://codecov.io/gh/Zeroto521/foliplus">
      <img src="https://codecov.io/gh/Zeroto521/foliplus/branch/main/graph/badge.svg" alt="Codecov">
  </a>
  <a href="https://foliplus.readthedocs.io/en/latest/?badge=latest">
      <img src="https://readthedocs.org/projects/foliplus/badge/?version=latest" alt="Documentation">
  </a>
</p>

## Features

| Control                 | Description                                                                            |
| :---------------------- | :------------------------------------------------------------------------------------- |
| 📷 **ExportControl**     | Capture a specific area of the map and export it as an image.                          |
| 🖥️ **FullscreenControl** | Fullscreen toggle with auto-hide for other controls.                                   |
| 🔥 **HeatmapControl**    | H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.                  |
| 🗂️ **LayerControl**      | Drag-and-drop layer ordering with geometry icons, color picker, and panes.             |
| 🎯 **LocateControl**     | Fly to the user's current position.                                                    |
| 📏 **MeasureControl**    | Distance measurement, area measurement, circle drawing, and GPS marker with geocoding. |
| 📐 **ScaleControl**      | Scale bar with metric or imperial units and optional zoom level display.               |
| 🔍 **SearchControl**     | Coordinate and address search via Nominatim reverse geocoding.                         |

## Quick Start

```bash
pip install foliplus
```

```python
import folium
import foliplus

m = folium.Map(location=[31.23, 121.47], zoom_start=12)

foliplus.MeasureControl().add_to(m)
foliplus.ExportControl().add_to(m)
foliplus.SearchControl().add_to(m)
foliplus.HeatmapControl().add_to(m)
foliplus.LayerControl().add_to(m)

m.save("map.html")
```

## Beyond Plugins

Traditional map component libraries treat each tool as an independent plugin. foliplus
was designed as a **platform** from the start:

- Components **communicate** with each other, instead of working in isolation
- Layers are **managed centrally**, instead of each tool creating its own DOM
- Conflicts are **resolved automatically**, instead of tools interfering with each other
- Third-party components can **plug into** the system, instead of being locked out

## Built-in Coordination

Every component in foliplus registers its canvas or layer through **LayerControl**,
which manages z-order, visibility, and lifecycle centrally.
This means all tools share a single layer stack—no z-index clashes, no orphaned DOM
elements.

On top of this shared layer foundation, tools coordinate further:

- While **measuring**, search and locate are blocked to prevent map interaction conflicts
- During **export**, measurement pauses, heatmap renders in full resolution, and layer
  order is synced for a complete screenshot
- When a layer is **deleted** from the layer panel, the component that owns it
  (e.g. measurement) auto-cleans its state
- When layers change, the heatmap refreshes automatically

All of this happens without manual wiring—the framework handles it internally.
