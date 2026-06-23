# foliplus

[![CI](https://**github**.com/Zeroto521/foliplus/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeroto521/foliplus/actions/workflows/ci.yml)
[![PyPI version](https://img.shields.io/pypi/v/foliplus)](https://pypi.org/project/foliplus/)
[![Python versions](https://img.shields.io/pypi/pyversions/foliplus)](https://pypi.org/project/foliplus/)
[![License](https://img.shields.io/pypi/l/foliplus)](LICENSE)

**foliplus** is a practical [Folium](https://python-visualization.github.io/folium/)
extension toolkit built to simplify spatial data visualization workflows and focus on
your data analysis.

## Features

- 🗺️ **MapSearch** — Coordinate & address search with Nominatim geocoding
- 🧭 **LayerControl** — Enhanced layer switcher with drag-and-drop, color layers, and SVG icons
- 🖥️ **Fullscreen** — Fullscreen toggle that hides other controls for a clean view
- 🔥 **HeatmapControl** — H3 hexbin aggregation heatmap with real-time zoom adaptation
- 📏 **MeasureControl** — Distance measurement, circle drawing, and GPS locate tools
- 📐 **ScaleControl** — Scale bar with metric/imperial units and optional zoom label
- 🎨 **Unified Design** — Consistent CSS design tokens shared across all components

## Installation

```bash
pip install foliplus
```

Requires Python ≥ 3.10 and Folium ≥ 0.14.0.

## Quick Start

```python
import folium
from foliplus import MapSearch, LayerControl, Fullscreen, ScaleControl

m = folium.Map(location=[26.08, 119.30], zoom_start=12)

# Add enhanced controls
MapSearch(zoom=16, position="topright").add_to(m)
LayerControl(position="topleft").add_to(m)
Fullscreen(position="bottomright").add_to(m)
ScaleControl(position="bottomleft", imperial=True).add_to(m)

m.save("map.html")
```
