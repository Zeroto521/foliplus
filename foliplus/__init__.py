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
from .control.ExportControl import ExportControl
from .control.FullscreenControl import FullscreenControl
from .control.HeatmapControl import HeatmapControl
from .control.LayerControl import LayerControl
from .control.LocateControl import LocateControl
from .control.MeasureControl import MeasureControl
from .control.ScaleControl import ScaleControl
from .control.SearchControl import SearchControl
from .locale import LocaleConfig

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
