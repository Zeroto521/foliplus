"""foliplus — pragmatic Folium map plugins for spatial data workflows."""

from importlib.metadata import PackageNotFoundError, version

try:
    from ._version import __version__
except ImportError:
    try:
        __version__ = version("foliplus")
    except PackageNotFoundError:
        __version__ = "unknown"

from .BaseControl import BaseControl
from .locale import LocaleConfig
from .plugin.ExportControl import ExportControl
from .plugin.FullscreenControl import FullscreenControl
from .plugin.HeatmapControl import HeatmapControl
from .plugin.LayerControl import LayerControl
from .plugin.LocateControl import LocateControl
from .plugin.MeasureControl import MeasureControl
from .plugin.ScaleControl import ScaleControl
from .plugin.SearchControl import SearchControl

__all__ = [
    "BaseControl",
    "ExportControl",
    "FullscreenControl",
    "HeatmapControl",
    "LayerControl",
    "LocaleConfig",
    "LocateControl",
    "MeasureControl",
    "ScaleControl",
    "SearchControl",
]
