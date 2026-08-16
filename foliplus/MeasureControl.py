from __future__ import annotations

from typing import Literal

from ._cdn import GCOORD, TURF
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

EXPORT_FORMAT = Literal["geojson", "csv", "kml"]


class MeasureControl(BaseControl):
    """Distance measurement, area measurement, circle drawing, and GPS marker with geocoding.

    - 📍 **Locate**: click to place a marker showing coordinates and reverse-geocoded
      address. Click the popup or the × on the marker to delete it.
    - 📏 **Distance**: click to draw a polyline. Segment and total distances update
      in real-time. Double-click / right-click / click the last node to finish.
    - 🔲 **Area**: click to draw a polygon. The enclosed area and each side's
      length are labelled. Double-click / right-click / click the first or last
      node to finish.
    - ⭕ **Circle**: first click sets the center; move the mouse to set the radius;
      second click confirms.
    - 🗑️ **Clear**: remove all measurement layers at once.

    After drawing a line, polygon, circle, or placing a marker: click the object
    to toggle labels and × buttons; click empty map space to hide × buttons.

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - Escape
         - Exit measurement mode


    Parameters
    ----------
    position : str, default "bottomright"
        One of "topleft", "topright", "bottomleft", "bottomright"\.

    show_bearing : bool, default True
        Whether to show the bearing (azimuth, 0°–360° clockwise from north) alongside
        the distance in segment labels, e.g. ``45° | 1.2 km``. Only applies to
        distance mode; area and circle modes always show plain distance.

    export_format : str, default "geojson"
        Default export format for measurements. One of ``"geojson"``, ``"csv"``,
        or ``"kml"``. The user can switch formats at runtime; this value sets
        the initial selection in the export dropdown.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    **Persistence.** Measurements survive page reloads — they are saved to
    ``localStorage`` (keyed by map container id) and restored automatically.

    **Export formats.** Measurements can be exported to three formats:

    * **GeoJSON** (default) — full geometry with coordinates, distances, areas,
      and radii as properties. Compatible with Leaflet, QGIS, ArcGIS, and
      any GIS software.
    * **CSV** — tabular summary with per-segment distances and per-feature areas.
      Suitable for Excel/Numbers analysis.
    * **KML** — for Google Earth import. Geometry with placemark names.

    **Interaction.** Clicking an existing node during drawing does nothing (the marker
    stops the event from propagating to the map). This prevents duplicate points and
    overlapping labels.

    Examples
    --------
    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl().add_to(m)
    """

    _export_fields = ("show_bearing", "export_format")

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
        export_format: EXPORT_FORMAT = "geojson",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.show_bearing = show_bearing
        self.export_format = export_format
        self._template = self._get_template()