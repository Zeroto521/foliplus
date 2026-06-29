"""foliplus — pragmatic Folium map plugins for spatial data workflows.

Components
----------
MapSearch
    Coordinate and address search via Nominatim reverse geocoding.

LayerControl
    Drag-and-drop layer ordering with geometry icons, color picker, and panes.

HeatmapControl
    H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.

ScaleControl
    Scale bar with metric units and optional zoom level display.

Fullscreen
    Fullscreen toggle with auto-hide for other controls.

MeasureControl
    Distance measurement, circle drawing, and GPS marker with geocoding.
"""

from .Fullscreen import Fullscreen
from .HeatmapControl import HeatmapControl
from .LayerControl import LayerControl
from .MapSearch import MapSearch
from .MeasureControl import MeasureControl
from .ScaleControl import ScaleControl

__all__ = [
    "Fullscreen",
    "HeatmapControl",
    "LayerControl",
    "MapSearch",
    "MeasureControl",
    "ScaleControl",
]

__version__ = "0.1.0"
