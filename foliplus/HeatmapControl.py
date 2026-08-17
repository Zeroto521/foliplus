from __future__ import annotations

from typing import Literal, get_args

from ._cdn import CHROMA, H3, SS
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

METHOD = Literal["jenks", "quantile", "equal", "heads"]
AGG = Literal["count", "sum", "avg", "min", "max"]
LABEL_FORMAT = Literal["auto", "int", "comma"]


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
       * - ArrowLeft
         - Select the previous color scheme
       * - ArrowRight
         - Select the next color scheme

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    color_scheme : str, default "Reds"
        Default color scheme name. Supports chroma.js / ColorBrewer palettes: ``Blues``,
        ``Greens``, ``Reds``, ``Oranges``, ``Purples``, ``YlOrRd``, ``Viridis``.

    method : Literal["jenks", "quantile", "equal", "heads"], default "jenks"
        Default classification method.

    n_classes : int, default 6
        Number of classification classes, range 2-9.

    agg : Literal["count", "sum", "avg", "min", "max"], default "count"
        Default aggregation method.

    schemes : list[str], optional
        List of available color scheme names. Can include custom hex values like
        ``["#f00", "#0f0", "#00f"]``.

    field : str or None, default None
        Property name to aggregate on. ``None`` counts features per hexagon
        (auto-detected from the first numeric property); a string aggregates
        that numeric property.

    border_weight : float, default 1.5
        Hexagon border width in canvas units.

    border_color : str, default "#333333"
        Hexagon border color.

    fill_opacity : float, default 0.7
        Hexagon fill opacity.

    border_opacity : float, default 0.9
        Hexagon border opacity.

    label_show : bool, default True
        Whether to show the aggregated value as a label at each hex center.

    label_size : int, default 11
        Label font size (px).

    label_color : str, default "#fff"
        Label text color.

    label_format : Literal["auto", "int", "comma"], default "auto"
        Number format for labels: ``"auto"`` (10K/1K suffix), ``"int"``,
        or ``"comma"`` (thousands separator).

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl().add_to(m)
    >>> HeatmapControl(field="value", border_weight=2.0, label_show=False).add_to(m)
    """

    default_js = [
        ("h3-js", f"https://cdn.jsdelivr.net/npm/h3-js@{H3}/dist/h3-js.umd.js"),
        (
            "simple-statistics",
            f"https://cdn.jsdelivr.net/npm/simple-statistics@{SS}/dist/simple-statistics.min.js",
        ),
        (
            "chroma-js",
            f"https://cdn.jsdelivr.net/npm/chroma-js@{CHROMA}/chroma.min.js",
        ),
    ]

    _export_fields = (
        "field",
        "color_scheme",
        "method",
        "n_classes",
        "agg",
        "schemes",
        "border_weight",
        "border_color",
        "fill_opacity",
        "border_opacity",
        "label_show",
        "label_size",
        "label_color",
        "label_format",
    )

    def __init__(
        self,
        *,
        position: Position = "topleft",
        color_scheme: str = "Reds",
        method: METHOD = "jenks",
        n_classes: int = 6,
        agg: AGG = "count",
        schemes: list[str] | None = None,
        field: str | None = None,
        border_weight: float = 1.5,
        border_color: str = "#333333",
        fill_opacity: float = 0.7,
        border_opacity: float = 0.9,
        label_show: bool = True,
        label_size: int = 11,
        label_color: str = "#fff",
        label_format: LABEL_FORMAT = "auto",
        locale: str | LocaleConfig | None = None,
    ):
        if method not in get_args(METHOD):
            raise ValueError(
                f"method must be one of {get_args(METHOD)}, got {method!r}"
            )
        if not isinstance(n_classes, int) or n_classes < 2 or n_classes > 9:
            raise ValueError(
                f"n_classes must be an int between 2 and 9, got {n_classes!r}"
            )
        if agg not in get_args(AGG):
            raise ValueError(f"agg must be one of {get_args(AGG)}, got {agg!r}")
        if label_format not in get_args(LABEL_FORMAT):
            raise ValueError(
                f"label_format must be one of {get_args(LABEL_FORMAT)}, got {label_format!r}"
            )

        super().__init__(position=position, locale=locale)
        self.field = field
        self.color_scheme = color_scheme
        self.method = method
        self.n_classes = n_classes
        self.agg = agg
        self.schemes = schemes or [
            "Blues",
            "Greens",
            "Reds",
            "Oranges",
            "Purples",
            "YlOrRd",
            "Viridis",
        ]
        self.border_weight = border_weight
        self.border_color = border_color
        self.fill_opacity = fill_opacity
        self.border_opacity = border_opacity
        self.label_show = label_show
        self.label_size = label_size
        self.label_color = label_color
        self.label_format = label_format
        self._template = self._get_template()
