from __future__ import annotations

from typing import Literal

from ._cdn_loader import load_cdn
from ._typing import Position, Zoom
from ._validate import validate
from .BaseControl import BaseControl
from .locale import LocaleConfig

MODE = Literal["coord", "addr"]


class SearchControl(BaseControl):
    """Coordinate and address search via Nominatim reverse geocoding.

    - 📍 **Coordinate search**: enter a coordinate like `longitude, latitude` to fly to
      and place a marker.
    - 🌐 **Address search**: enter a keyword and geocode via Nominatim.

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - Escape
         - Close the search panel or dismiss suggestions
       * - ArrowDown
         - Move to the next suggestion
       * - ArrowUp
         - Move to the previous suggestion

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    mode : Literal["coord", "addr"], default "coord"
        Default search mode on first open.

    zoom : int, default 15
        Zoom level after coordinate search, between 1 and 18.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import SearchControl
    >>> m = folium.Map()
    >>> SearchControl().add_to(m)
    """

    _export_fields = ("mode", "zoom")

    default_js = load_cdn("SearchControl")

    @validate
    def __init__(
        self,
        *,
        position: Position = "topleft",
        mode: MODE = "coord",
        zoom: Zoom = 15,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.mode = mode
        self.zoom = zoom
        self._template = self._get_template()
