from __future__ import annotations

from typing import Annotated, Literal

from ._config_schema import FieldSpec
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

    Args
    ----
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
        Starting filter on the measurement types, as a list of type names::

            MeasureControl(filter=["distance", "polygon"])

        Names are the values the panel's filter row offers (``distance``,
        ``polygon``, ``circle``, ``marker``). The runtime drops a name it
        does not know rather than hiding every measurement, and a declaration
        that keeps no type at all is reported once and ignored.

        This is a starting condition, not user intent: it seeds the filter on
        the first open, and the user's own filter wins from then on. Clearing
        the filter row is a user write (the record then exists and says
        "cleared"), so the declaration does not come back after a reload —
        unlike ``HeatmapControl``, whose panel Clear is the factory Reset.

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

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Notes
    -----
    **Filter arms.** The ``filter`` declaration has two shapes, one per control that
    declares it. The range arm belongs to ``HeatmapControl`` and the enum arm to
    ``MeasureControl``; each is normalised into the shared filter AST the runtime
    already reads, so the panel shows exactly one condition row per declaration.

    .. list-table::
       :header-rows: 1

       * - Arm
         - Owner
         - Declaration shape
       * - Range
         - ``HeatmapControl``
         - ``{"field": ..., "between": [lo, hi]}``
       * - Enum
         - ``MeasureControl``
         - ``["distance", "polygon", ...]``

    **Three rules.**

    - *API misuse.* A missing or non-string ``field`` raises ``ValueError`` in
      the cell that wrote the declaration — a declaration that names nothing is
      a programming error, not a filter state.
    - *Data shape.* A field the panel does not filter, no numeric extent, a range
      outside the data, or a non-numeric bound is reported once with a warning and
      treated as undeclared — the layer is never silently filtered to empty.
    - *Starting condition.* The declaration seeds the filter on the first open;
      the user's own filter — including an explicit clear or a persisted record —
      wins from then on. The panel's Clear is the factory Reset (it drops the saved
      record, so a reload re-applies the declaration), whereas a user-write Clear
      keeps the declaration out.

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
