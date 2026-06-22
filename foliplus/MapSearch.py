from __future__ import annotations

from typing import Optional

from .base import BaseControl
from .locale import LocaleConfig


class MapSearch(BaseControl):
    """Map search control with coordinate and address lookup modes.

    Adds a collapsible search box to the map supporting two modes:

    - **Coordinate search** (default): enter latitude/longitude to fly to and
      place a marker.
    - **Address search**: enter a keyword and geocode via Nominatim.

    Switch between modes via the tool button inside the expanded panel.

    Parameters
    ----------
    zoom : int, default 15
        Zoom level after coordinate search. Typically 1-18.
    position : str, default "topleft"
        Control position. One of ``"topleft"``, ``"topright"``,
        ``"bottomleft"``, ``"bottomright"``.
    locale : LocaleConfig, optional
        Localization configuration. Defaults to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import MapSearch
    >>> m = folium.Map()
    >>> MapSearch(zoom=16, position="topright").add_to(m)
    """

    def __init__(
        self,
        zoom: int = 15,
        position: str = "topleft",
        locale: Optional[LocaleConfig] = None,
    ):
        super().__init__(position=position, locale=locale)
        self.zoom = zoom
        self._template = self._get_template(
            css_file="MapSearch.css", js_file="MapSearch.js"
        )
