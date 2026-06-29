from __future__ import annotations

from typing import Literal

from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class MapSearch(BaseControl):
    """Map search control with coordinate and address lookup modes.

    Adds a collapsible search box to the map supporting two modes:

    - 📍 **Coordinate search**: enter a coordinate like `longitude, latitude` to fly to
      and place a marker.
    - 🌐 **Address search**: enter a keyword and geocode via Nominatim.

    Switch between modes via the tool button inside the expanded panel.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    mode : Literal["coord", "addr"], default "coord"
        Default search mode on first open. ``"coord"`` for coordinate search, ``"addr"``
        for address (Nominatim) search.

    zoom : int, default 15
        Zoom level after coordinate search. Typically 1-18.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import MapSearch
    >>> m = folium.Map()
    >>> MapSearch().add_to(m)
    """

    def __init__(
        self,
        position: Position = "topleft",
        mode: Literal["coord", "addr"] = "coord",
        zoom: int = 15,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.mode = mode
        self.zoom = zoom
        self._template = self._get_template(
            js_file="MapSearch.js", css_file="MapSearch.css"
        )
