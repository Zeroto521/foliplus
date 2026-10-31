from __future__ import annotations

from typing import Annotated, Any, Literal

from ._config_schema import FieldSpec
from ._declaration import _normalise_zoom_range
from ._declared_filter import MEASURE_TYPE_FIELD, normalize_declared_filter
from ._typing import ControlPosition
from ._validate import validate
from .BaseControl import BaseControl
from .locale import LocaleConfig

ExportFormat = Literal["geojson", "csv"]


class MeasureControl(BaseControl):
    """
    Measure distances, areas, and circles; place geocoded markers; then edit by
    dragging nodes.

    - 📍 **Locate**: click to place a marker showing coordinates and reverse-geocoded
      address. Click the popup or the × on the marker to delete it.
    - 📏 **Distance**: click to draw a polyline. Segment and total distances update in
      real-time. Double-click / right-click / click the last node to finish.
    - 🔲 **Area**: click to draw a polygon. The enclosed area and each side's length are
      labeled. Double-click / right-click / click the first or last node to finish.
    - ⭕ **Circle**: first click sets the center; move the mouse to set the radius;
      second click confirms.
    - ✏️ **Edit**: enter edit mode to reposition finished measurements. Click a
      measurement to reveal its × delete handles, then drag its nodes to reshape it —
      labels update live and changes persist on release. Drag the circle center or the
      area centroid to translate the whole shape, the circle radius node to resize, or
      a marker to move it (its address is re-resolved on drop).
    - 🗑️ **Clear**: remove all measurement layers at once.
    - 🏷️ **Labels**: measurement labels sit on their anchor (segment midpoint,
      centroid, or radius) and are never nudged. When dense, the collision
      detector hides the least-important overlapping chips so labels remain
      readable — see ``label_collide`` for the exact hiding rule and
      priority order.

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

    label_show : bool, default True
        Whether to show the measurement labels. Hidden labels stay registered
        (collision and placement state is untouched) — switching back on
        restores them on their anchors. Overridable at runtime from the layer
        style drawer.

    label_collide : bool, default True
        Whether to run the label collision detector. When enabled, a label is
        hidden only when two chips **intersect on the y-axis AND** overlap at
        least 75% of the narrower chip's width on the x-axis, so chips that
        share a screen column but are stacked vertically (e.g. labels on two
        near-vertical polygon edges at very different y) stay visible and a
        light edge graze is left alone. Hiding sweeps labels from strongest
        to weakest — centroid and radius, then the distance mode's final
        total, then plain segments; a tie goes to the wider chip — so the
        most important label always keeps its anchor. When disabled, every
        label stays visible on its anchor regardless of overlap. Only affects
        on-screen layout, never exports (CSV / GeoJSON always read persisted
        measurements).

    show_live_coords : bool, default True
        Whether to show a live longitude/latitude readout. While any drawing mode
        is armed — and again while edit mode is on — a small chip trails the cursor
        for the whole time, including before the first click, so the coordinate about
        to be placed or dragged is visible instead of only the ones already placed.
        It hangs due south of the pointer, the same way the area label sits south of
        the centroid dot, and is flipped above the pointer near the bottom edge of
        the map. It disappears as soon as the measurement is finalized: a finished
        measurement is described by its shape and segment labels, not by a coordinate
        under the pointer. No coordinate-system conversion is applied — the chip
        reports the map's own coordinates as they are, so it stays put under the
        cursor on GCJ02 / BD09 tile sets.

    filter : list[str], optional
        Starting filter on the measurement types. See Notes for the
        declaration shape and the runtime's handling of unknown names.

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

    collapse_on_outside : bool, default True
        Whether a press outside the panel collapses it.

    zoom_range : dict, optional
        Visibility window over the map's zoom levels: a mapping with ``min``
        and ``max`` (both required integers, ``min <= max``) that keeps the
        control visible only while the map's zoom is inside the range. Outside
        the range the whole toolbar is hidden; it comes back on the next zoom
        that is inside. A malformed declaration, or one that cannot meet the
        map's own zoom range, warns once and is treated as undeclared (the
        toolbar stays visible). Measurements are never hidden or deleted by
        this declaration — it gates the toolbar, not the data.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl().add_to(m)

    With a declared starting filter on the measurement types:

    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl(filter=["distance", "polygon"]).add_to(m)

    Only show the toolbar while the map is between zoom levels 8 and 12:

    >>> import folium
    >>> from foliplus import MeasureControl
    >>> m = folium.Map()
    >>> MeasureControl(zoom_range={"min": 8, "max": 12}).add_to(m)

    Notes
    -----
    **Filter declaration.** ``filter`` is a list of measurement-type names (the
    range arm, a ``min``/``max`` mapping, belongs to ``HeatmapControl``):

    +--------------+----------+----------+--------------------------------------------------+
    | Key          | Type     | Required | Meaning                                          |
    +==============+==========+==========+==================================================+
    | each element | ``str``  | yes      | A measurement-type name the panel's filter row   |
    |              |          |          | offers: ``distance``, ``polygon``, ``circle``,   |
    |              |          |          | ``marker``.                                      |
    +--------------+----------+----------+--------------------------------------------------+

    **Situation → behavior.**

    +--------------------------------------------+--------------------------------------------+
    | Situation                                  | Behavior                                   |
    +============================================+============================================+
    | A name the runtime does not know           | Dropped (not a filter that hides every     |
    |                                            | measurement).                              |
    +--------------------------------------------+--------------------------------------------+
    | A declaration that keeps no type at all    | Reported once with a warning; treated as   |
    |                                            | undeclared.                                |
    +--------------------------------------------+--------------------------------------------+
    | User write                                 | Wins from then on; the declaration is a    |
    |                                            | starting condition only.                   |
    +--------------------------------------------+--------------------------------------------+
    | User explicit Clear (= factory Reset)      | Deletes the saved record, so the           |
    |                                            | declaration re-seeds (this session and on  |
    |                                            | reload).                                   |
    +--------------------------------------------+--------------------------------------------+

    **Zoom-range declaration.** ``zoom_range={"min": 8, "max": 12}`` takes the
    same shape the per-layer ``foliplus`` declaration uses:

    +---------+------+----------+--------------------------------------------------+
    | Key     | Type | Required | Meaning                                          |
    +=========+======+==========+==================================================+
    | ``min`` | int  | yes      | Lowest zoom at which the toolbar is visible.     |
    +---------+------+----------+--------------------------------------------------+
    | ``max`` | int  | yes      | Highest zoom at which the toolbar is visible.    |
    +---------+------+----------+--------------------------------------------------+

    Outside the range the toolbar is hidden, not disabled: an active mode is
    left alone, and measurements already on the map stay visible. A malformed
    declaration (missing key, non-int, inverted, unknown key) and a range that
    cannot intersect the map's own zoom levels both warn once and are treated
    as undeclared, so the toolbar never disappears for every map view.
    """

    @validate
    def __init__(
        self,
        *,
        position: ControlPosition = "bottomright",
        show_bearing: bool = True,
        label_show: bool = True,
        label_collide: bool = True,
        show_live_coords: bool = True,
        filter: Annotated[
            list[str] | None,
            FieldSpec(
                ts="object",
                note=(
                    "Declared measurement-type filter: the shared filter AST "
                    "normalised from the friendly list of type names the "
                    "argument takes; a persisted user filter wins."
                ),
            ),
        ] = None,
        filename: str = "measurements",
        export_format: ExportFormat = "geojson",
        collapse_on_outside: bool = True,
        zoom_range: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="ZoomRange",
                name="ZoomRange",
                shape={"min": "number", "max": "number"},
                config_key="zoomRange",
                note=(
                    "Declared zoom range: the toolbar is visible only while the "
                    "map's zoom is inside it; a malformed or unreachable range is "
                    "treated as undeclared."
                ),
            ),
        ] = None,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.show_bearing = show_bearing
        self.label_show = label_show
        self.label_collide = label_collide
        self.show_live_coords = show_live_coords
        # The constructor argument is the friendly list; the exported attribute
        # is the AST the runtime reads. Two values, one name only on the public
        # surface: CONF must not grow a second filter dialect.
        self.filter = normalize_declared_filter(
            filter, owner="MeasureControl", arm="enum", enum_field=MEASURE_TYPE_FIELD
        )
        self.filename = filename
        self.export_format = export_format
        self.collapse_on_outside = collapse_on_outside
        # The author writes zoom_range={"min": ..., "max": ...}; CONF carries
        # the normalised {min, max} under the shared `zoomRange` key. Invalid
        # declarations warn once and stay None (the toolbar is not hidden).
        self.zoomRange = _normalise_zoom_range(
            zoom_range, owner="MeasureControl", source="zoom_range"
        )
