from __future__ import annotations

from typing import Annotated, Any, Literal

from ._config_schema import FieldSpec
from ._declaration import _normalise_zoom_range
from ._declared_filter import normalize_declared_filter
from ._typing import ControlPosition, Fraction, PositiveInt
from ._validate import Bound, validate
from .BaseControl import BaseControl
from .locale import LocaleConfig

METHOD = Literal["jenks", "quantile", "equal", "heads"]
AGG = Literal["count", "sum", "avg", "min", "max"]
LABEL_FORMAT = Annotated[
    Literal["auto", "int", "comma", "percent"],
    FieldSpec(name="NumberStyle", note="Number format for hexagon value labels."),
]


class HeatmapControl(BaseControl):
    """H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.

    .. note::

        Only markers with a ``.feature`` property (GeoJSON / ``df.explore``) are
        counted. Annotation or label markers without ``.feature`` are skipped to avoid
        double-counting in hexbin aggregation.

    Shortcuts
    ---------

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - ArrowUp
         - Select the previous color scheme
       * - ArrowDown
         - Select the next color scheme
       * - Enter / Space
         - Open the scheme dropdown
       * - ArrowDown (dropdown)
         - Focus the next scheme option
       * - ArrowUp (dropdown)
         - Focus the previous scheme option
       * - Enter (dropdown)
         - Select the focused scheme option
       * - Escape (dropdown)
         - Close the dropdown without selecting

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    layer : str, optional
        Name of the point layer to select when the map first loads. Matching is
        by the layer's folium ``name`` (the same text the panel's Layer row
        lists); the first match wins. This is a starting selection only: a
        layer the user picked earlier (persisted in the browser) wins, and the
        panel still lets the user switch. A name that matches no point layer is
        ignored with a console warning and the panel falls back to its normal
        auto-selection (the only point layer is selected automatically).

    agg : Literal["count", "sum", "avg", "min", "max"], default "count"
        Default aggregation method. A ``filter`` declaration needs a value
        aggregation (not ``"count"``) — count aggregates by nothing, so a range
        has no field to bind to and raises (see Notes).

    field : str, optional
        Aggregation field to select when the map first loads. Only a numeric
        field the layer actually carries is accepted; anything else is ignored
        with a console warning and the panel falls back to its normal default
        field (the first numeric field). Like ``layer``, a persisted user
        choice wins, and a ``count`` aggregation does not use the field until
        the user switches to a value aggregation — a ``filter`` declaration
        with ``agg="count"`` is therefore API misuse and raises (see Notes).

    filter : dict, optional
        Starting filter on the aggregation field: a mapping with ``min`` and
        ``max`` (the range is bound to ``field=``). See Notes for the declaration
        shape and the failure modes listed there.

    method : Literal["jenks", "quantile", "equal", "heads"], default "jenks"
        Default classification method.

    num_classes : int, default 6
        Number of classification classes, range 2-9.

    color_scheme : str, default "Reds"
        Default color scheme name. Supports chroma.js / ColorBrewer palettes: ``Blues``,
        ``Greens``, ``Reds``, ``Oranges``, ``Purples``, ``YlOrRd``, ``Viridis``.

    schemes : list[str], default ["Blues", "Greens", "Reds", "Oranges", "Purples", "YlOrRd", "Viridis"]
        List of available color scheme names. Can include custom hex values like
        ``["#f00", "#0f0", "#00f"]``.

    border_color : str, default "#333333"
        Hexagon border color.

    border_weight : float, default 1.5
        Hexagon border width in canvas units. Must not be negative.

    border_opacity : float, default 0.9
        Hexagon border opacity, between 0.0 and 1.0.

    fill_opacity : float, default 0.7
        Hexagon fill opacity, between 0.0 and 1.0.

    label_show : bool, default True
        Whether to show the aggregated value as a label at each hex center.

    label_color : str, default "#fff"
        Label text color.

    label_size : int, default 11
        Label font size (px). Must be positive.

    label_format : Literal["auto", "int", "comma", "percent"], default "auto"
        Number format for hexagon value labels:

        - ``"auto"``: locale-native compact notation (en ``10K``, zh ``1.2万``);
          zh values below 1万 render ungrouped (``6000``). Follows the plugin
          locale.
        - ``"int"``: plain integer with no grouping (``6000``).
        - ``"comma"``: thousands separator (``6,000``).
        - ``"percent"``: fraction × 100 with a ``%`` suffix (``0.35`` → ``35%``).

        ``"int"``, ``"comma"``, and ``"percent"`` are locale-agnostic.

    collapse_on_outside : bool, default True
        Whether a press outside the panel collapses it.

    zoom_range : dict, optional
        Visibility window over the map's zoom levels: a mapping with ``min``
        and ``max`` (both required integers, ``min <= max``) that keeps the
        control visible only while the map's zoom is inside the range. Outside
        the range the whole control is hidden with the shared
        ``foliplus-hidden`` class; it comes back on the next zoom that is
        inside. A malformed declaration, or one that cannot meet the map's own
        zoom range, warns once and is treated as undeclared (the control stays
        visible) — never as a declaration that hides it everywhere.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl().add_to(m)

    With a declared starting filter on the aggregation field:

    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl(
    ...     agg="sum", field="score", filter={"min": 10, "max": 50}
    ... ).add_to(m)

    Only show the control while the map is between zoom levels 8 and 12:

    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl(zoom_range={"min": 8, "max": 12}).add_to(m)

    Notes
    -----
    **Filter declaration.** ``filter`` is a mapping with ``min`` and ``max``
    (the enum arm, a list of measurement types, belongs to ``MeasureControl``):

    +--------------------+----------------------+----------+----------------------------------------------+
    | Key                | Type                 | Required | Meaning                                      |
    +====================+======================+==========+==============================================+
    | ``min`` / ``max``  | ``number`` each      | yes      | Inclusive range on the aggregation field     |
    |                    |                      |          | (``field=``).                                |
    +--------------------+----------------------+----------+----------------------------------------------+

    **Situation → behavior.**

    +--------------------------------------------+--------------------------------------------+
    | Situation                                  | Behavior                                   |
    +============================================+============================================+
    | ``field`` key inside ``filter``, or no     | ``ValueError`` in the cell that wrote the  |
    | aggregation field (no ``field=``, or       | declaration.                               |
    | ``agg="count"``)                           |                                            |
    +--------------------------------------------+--------------------------------------------+
    | Data-shaped problem (no numeric extent,    | Reported once with a warning; treated as   |
    | range outside the data, non-numeric bound) | undeclared — never silently filtered to    |
    |                                            | empty.                                     |
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
    | ``min`` | int  | yes      | Lowest zoom at which the control is visible.     |
    +---------+------+----------+--------------------------------------------------+
    | ``max`` | int  | yes      | Highest zoom at which the control is visible.    |
    +---------+------+----------+--------------------------------------------------+

    Outside the range the control is hidden, not disabled, so its saved state
    survives the trip. A malformed declaration (missing key, non-int,
    inverted, unknown key) and a range that cannot intersect the map's own
    zoom levels both warn once and are treated as undeclared: the control
    stays visible rather than disappearing for every map view.
    """

    @validate
    def __init__(
        self,
        *,
        position: ControlPosition = "topleft",
        layer: Annotated[
            str | None,
            FieldSpec(
                ts="",
                note="Point layer name selected on first load; a persisted user selection wins.",
            ),
        ] = None,
        agg: AGG = "count",
        field: Annotated[
            str | None,
            FieldSpec(
                ts="",
                note="Aggregation field selected on first load (and the field a declared filter range binds to); a persisted user selection wins.",
            ),
        ] = None,
        filter: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="",
                note=(
                    "Declared filter on the aggregation field: a mapping with min and max "
                    "(bound to field=), normalised to the shared filter AST; a persisted "
                    "user filter wins."
                ),
            ),
        ] = None,
        method: METHOD = "jenks",
        num_classes: Annotated[int, Bound(2, 9)] = 6,
        color_scheme: str = "Reds",
        schemes: Annotated[
            list[str], FieldSpec(ts="", note="Available color scheme names.")
        ] = [
            "Blues",
            "Greens",
            "Reds",
            "Oranges",
            "Purples",
            "YlOrRd",
            "Viridis",
        ],
        border_color: str = "#333333",
        border_weight: Annotated[float, Bound(0.0, None)] = 1.5,
        border_opacity: Fraction = 0.9,
        fill_opacity: Fraction = 0.7,
        label_show: bool = True,
        label_color: str = "#fff",
        label_size: PositiveInt = 11,
        label_format: LABEL_FORMAT = "auto",
        collapse_on_outside: bool = True,
        zoom_range: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="ZoomRange",
                name="ZoomRange",
                shape={"min": "number", "max": "number"},
                config_key="zoomRange",
                note=(
                    "Declared zoom range: the control is visible only while the map's "
                    "zoom is inside it; a malformed or unreachable range is treated as "
                    "undeclared."
                ),
            ),
        ] = None,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.layer = layer
        self.agg = agg
        self.field = field
        # The declaration is normalised here, at construction, so CONF carries
        # the AST the runtime reads (never the friendly shape). A 'field' key
        # inside the declaration, or a range with no aggregation field to bind
        # to (no field=, or agg="count" — a count aggregates by nothing), raises
        # ValueError; a data-shaped problem warns and drops the declaration
        # instead of filtering to nothing.
        self.filter = normalize_declared_filter(
            filter,
            owner="HeatmapControl",
            arm="range",
            # A count aggregation has no field to bind the range to — the
            # declaration is API misuse and raises (see _range_atom).
            bound_field=self.field if agg != "count" else None,
        )
        self.method = method
        self.num_classes = num_classes
        self.color_scheme = color_scheme
        self.schemes = schemes
        self.border_color = border_color
        self.border_weight = border_weight
        self.border_opacity = border_opacity
        self.fill_opacity = fill_opacity
        self.label_show = label_show
        self.label_color = label_color
        self.label_size = label_size
        self.label_format = label_format
        self.collapse_on_outside = collapse_on_outside
        # The author writes zoom_range={"min": ..., "max": ...}; CONF carries
        # the normalised {min, max} under the shared `zoomRange` key. Invalid
        # declarations warn once and stay None (the control is not hidden).
        self.zoomRange = _normalise_zoom_range(
            zoom_range, owner="HeatmapControl", source="zoom_range"
        )
