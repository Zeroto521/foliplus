from __future__ import annotations

from typing import Annotated, Any, Literal

from ._config_schema import FieldSpec
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

    Args
    ----
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
        Default aggregation method.

    field : str, optional
        Aggregation field to select when the map first loads. Only a numeric
        field the layer actually carries is accepted; anything else is ignored
        with a console warning and the panel falls back to its normal default
        field (the first numeric field). Like ``layer``, a persisted user
        choice wins, and a ``count`` aggregation does not use the field until
        the user switches to a value aggregation.

    filter : dict, optional
        Starting filter on the aggregation field, written as a mapping with
        ``field`` and ``between``::

            HeatmapControl(
                field="score", filter={"field": "score", "between": [10, 50]}
            )

        ``field`` must name the field the panel filters — the same field the
        heatmap aggregates by (``field`` above), because a hexagon's only
        filterable dimension is that numeric range. A missing or non-string
        ``field`` raises ``ValueError`` in the cell that wrote it; a
        data-shaped problem (a field the panel does not filter, no numeric
        extent, a range outside the data, a non-numeric bound) is reported once
        with a warning and leaves the heatmap unfiltered. A range covering the
        whole extent means "no filter" and is accepted silently.

        This is a starting condition, not user intent: it seeds the filter on
        the first open (a declared ``layer``, the automatic single-layer
        selection, a restored source, and a source the user picks by hand), and
        the user's own filter — including an explicit clear — wins from then
        on. Note the asymmetry with the panel's Clear button: Clear is the
        factory Reset, it drops the saved record, so after a reload the
        declaration applies again. ``MeasureControl``'s filter row Clear is
        a user write and keeps the declaration out.

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
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl().add_to(m)

    With a declared starting filter on the aggregation field:

    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl(
    ...     field="score", filter={"field": "score", "between": [10, 50]}
    ... ).add_to(m)
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
                note="Aggregation field selected on first load; a persisted user selection wins.",
            ),
        ] = None,
        filter: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="",
                note=(
                    "Declared filter on the aggregation field, normalised to the "
                    "shared filter AST; a persisted user filter wins."
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
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.layer = layer
        self.agg = agg
        self.field = field
        # The declaration is normalised here, at construction, so CONF carries
        # the AST the runtime reads (never the friendly shape). A missing
        # 'field' raises ValueError; a data-shaped problem warns and drops the
        # declaration instead of filtering to nothing.
        self.filter = normalize_declared_filter(
            filter, owner="HeatmapControl", arm="range"
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
