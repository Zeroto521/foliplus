from __future__ import annotations

from ._cdn import GCOORD, TURF
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class MeasureControl(BaseControl):
    """Distance measurement, circle drawing, and GPS marker with geocoding.

    - 📍 **Locate**: click to place a marker showing coordinates and reverse-geocoded
      address. Click the popup or the × on the marker to delete it.
    - 📏 **Distance**: click to draw a polyline. Segment and total distances update
      in real-time. Double-click / right-click / click the last point to finish.
    - ⭕ **Circle**: first click sets the center; move the mouse to set the radius;
      second click confirms.
    - 🗑️ **Clear**: remove all measurement layers at once.

    After drawing a line or circle: click the object to toggle labels and × buttons;
    click empty map space to hide × buttons.

    Parameters
    ----------
    position : str, default "bottomright"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    show_bearing : bool, default True
        Whether to show the bearing (azimuth, 0°–360° clockwise from north) alongside
        the distance in measurement labels, e.g. ``45° | 1.2 km``.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    **Keyboard shortcuts.**
    While in measurement mode (after clicking the ruler icon):

    * ``Esc`` — exit measurement mode

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
