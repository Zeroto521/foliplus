from __future__ import annotations

from typing import Optional, Union

from ._typing import Position
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
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

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
        zoom: int = 15,
        position: Position = "topleft",
        locale: Optional[Union[str, LocaleConfig]] = None,
    ):
        super().__init__(position=position, locale=locale)
        self.zoom = zoom
        self._template = self._get_template(
            js_file="MapSearch.js", css_file="MapSearch.css"
        )
