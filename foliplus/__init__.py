"""foliplus — pragmatic Folium map plugins for spatial data workflows."""

from importlib.metadata import PackageNotFoundError, version

try:
    from ._version import __version__
except ImportError:
    try:
        __version__ = version("foliplus")
    except PackageNotFoundError:
        __version__ = "unknown"

# Annotation aliases carried at the root since v0.4.1; out of __all__ so a star
# import exports the controls only. New annotations import foliplus._typing.
from ._typing import ControlPosition, Fraction, PositiveInt, Zoom
from .BaseControl import BaseControl
from .ExportControl import ExportControl
from .FullscreenControl import FullscreenControl
from .HeatmapControl import HeatmapControl
from .LayerControl import LayerControl
from .locale import LocaleConfig
from .LocateControl import LocateControl
from .MeasureControl import MeasureControl
from .ScaleControl import ScaleControl
from .SearchControl import SearchControl

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
