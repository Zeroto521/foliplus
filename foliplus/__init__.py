"""foliplus — pragmatic Folium map plugins for spatial data workflows."""

from importlib.metadata import PackageNotFoundError, version

try:
    from ._version import __version__
except ImportError:
    try:
        __version__ = version("foliplus")
    except PackageNotFoundError:
        __version__ = "unknown"

from .FullscreenControl import FullscreenControl
from .HeatmapControl import HeatmapControl
from .LayerControl import LayerControl
from .MeasureControl import MeasureControl
from .ScaleControl import ScaleControl
from .SearchControl import SearchControl

__all__ = [
    "FullscreenControl",
    "HeatmapControl",
    "LayerControl",
    "MeasureControl",
    "ScaleControl",
    "SearchControl",
]
