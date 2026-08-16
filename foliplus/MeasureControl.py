from __future__ import annotations

from ._cdn import GCOORD, TURF
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class MeasureControl(BaseControl):
    """Distance measurement, area measurement, circle drawing, and GPS marker with geocoding.

    - Locate: click to place a marker showing coordinates and reverse-geocoded address.
    - Distance: click to draw a polyline. Double-click / right-click to finish.
    - Area: click to draw a polygon. Double-click / right-click to finish.
    - Circle: first click center, second click radius.
    - Clear: remove all measurement layers at once.

    Parameters
    ----------
    position : str, default "bottomright"
        One of "topleft", "topright", "bottomleft", "bottomright".

    show_bearing : bool, default True
        Whether to show the bearing (azimuth, 0-360 clockwise from north).

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.

    Notes
    -----
    Persistence. Measurements survive page reloads via localStorage.

    Keyboard shortcuts.
    While in measurement mode (after clicking the ruler icon):

    ========== =============================================
    Key        Action
    ========== =============================================
    Escape     Exit measurement mode
    ========== =============================================

    Examples
    --------
    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl().add_to(m)
    """

    _export_fields = ("show_bearing",)

    default_js = [
        (
            "gcoord",
            f"https://cdn.jsdelivr.net/npm/gcoord@{GCOORD}/dist/gcoord.global.prod.js",
        ),
        (
            "turf",
            f"https://cdn.jsdelivr.net/npm/@turf/turf@{TURF}/turf.min.js",
        ),
    ]

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        show_bearing: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.show_bearing = show_bearing
        self._template = self._get_template()
