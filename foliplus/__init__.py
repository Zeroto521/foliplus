"""foliplus — pragmatic Folium map plugins for spatial data workflows."""

from importlib.metadata import PackageNotFoundError, version

try:
    from ._version import __version__
except ImportError:
    try:
        __version__ = version("foliplus")
    except PackageNotFoundError:
        __version__ = "unknown"

from .ExportControl import ExportControl
from .Fullscreen import Fullscreen
from .HeatmapControl import HeatmapControl
from .LayerControl import LayerControl
from .MapSearch import MapSearch
from .MeasureControl import MeasureControl
from .ScaleControl import ScaleControl

__all__ = [
    "ExportControl",
    "Fullscreen",
    "HeatmapControl",
    "LayerControl",
    "MapSearch",
    "MeasureControl",
    "ScaleControl",
]
