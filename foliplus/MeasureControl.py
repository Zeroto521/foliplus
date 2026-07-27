from __future__ import annotations

from ._cdn import GCOORD
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

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl().add_to(m)
    """

    default_js = [
        (
            "gcoord",
            f"https://cdn.jsdelivr.net/npm/gcoord@{GCOORD}/dist/gcoord.global.prod.js",
        ),
    ]

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template(
            js_file="MeasureControl.js", css_file="MeasureControl.css"
        )
