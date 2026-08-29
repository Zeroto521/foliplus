from __future__ import annotations

from typing import Literal, get_args

from ._cdn_loader import load_cdn
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

ExportFormat = Literal["geojson", "csv"]


class MeasureControl(BaseControl):
    """
    Distance measurement, area measurement, circle drawing, location marker with
    geocoding, and node-drag edit mode.

    - 📍 **Locate**: click to place a marker showing coordinates and reverse-geocoded
      address. Click the popup or the × on the marker to delete it.
    - 📏 **Distance**: click to draw a polyline. Segment and total distances update in
      real-time. Double-click / right-click / click the last node to finish.
    - 🔲 **Area**: click to draw a polygon. The enclosed area and each side's length are
      labelled. Double-click / right-click / click the first or last node to finish.
    - ⭕ **Circle**: first click sets the center; move the mouse to set the radius;
      second click confirms.
    - ✏️ **Edit**: enter edit mode to reposition finished measurements. Click a
      measurement to reveal its × delete handles, then drag its nodes to reshape it —
      labels update live and changes persist on release. Drag the circle center or the
      area centroid to translate the whole shape, the circle radius node to resize, or
      a marker to move it (its address is re-resolved on drop).
    - 🗑️ **Clear**: remove all measurement layers at once.

    **Editing.** The pencil toolbar button toggles edit mode. Outside edit mode,
    clicking a measurement does not reveal its × handles. Edit mode and the drawing
    modes are mutually exclusive: entering one exits the other. Only one measurement
    shows × handles at a time — clicking another measurement closes the previous one.

    Shortcuts
    ---------

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - Escape
         - Exit the current measurement mode, or exit edit mode

    Parameters
    ----------
    position : str, default "bottomright"
        One of "topleft", "topright", "bottomleft", "bottomright".

    show_bearing : bool, default True
        Whether to show the bearing (azimuth, 0°–360° clockwise from north) alongside
        the distance in segment labels, e.g. ``45° | 1.2 km``. Only applies to distance
        mode; area and circle modes always show plain distance.

    filename : str, default "measurements"
        Base filename for exported files (without extension). The format extension is
        appended automatically: ``measurements.geojson`` or ``measurements.csv``.

    export_format : str, default "geojson"
        Default export format. One of ``"geojson"`` or ``"csv"``.

        - ``"geojson"`` produces a ``FeatureCollection`` where each feature's
          ``properties`` carries the measurement ``id``, type name, and type-specific
          fields (``address``, ``totalDistance``, ``area``, ``radius``, ``center``).
        - ``"csv"`` produces one row per measurement with an ``id`` column and a
          ``wkt`` column holding the Well-Known-Text geometry.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    **Export.** The toolbar's download button exports all current measurements as a
    ``{filename}.{export_format}`` browser download — see ``export_format`` for the
    output structure of each format.

    **Units.** Exported numeric fields use metric units:
        - distances and radius in meters
        - area in square meters
        - segment bearing in degrees (0-360, clockwise from north)
        - coordinates in longitude/latitude degrees

    **Persistence.** Measurements survive page reloads — they are saved to ``localStorage``
    (keyed by map container id) and restored automatically. Each persisted measurement
    keeps a unique ``id`` assigned on creation; the polygon's centroid is also persisted
    as ``center`` and included in exports.

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

    _export_fields = ("show_bearing", "filename", "export_format")

    default_js = load_cdn("MeasureControl")

    def __init__(
        self,
        *,
        position: Position = "bottomright",
        show_bearing: bool = True,
        filename: str = "measurements",
        export_format: ExportFormat = "geojson",
        locale: str | LocaleConfig | None = None,
    ):
        if export_format not in get_args(ExportFormat):
            raise ValueError(
                f"export_format must be one of {get_args(ExportFormat)}, "
                f"got {export_format!r}"
            )
        super().__init__(position=position, locale=locale)
        self.show_bearing = show_bearing
        self.filename = filename
        self.export_format = export_format
        self._template = self._get_template()
