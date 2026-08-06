from __future__ import annotations

from typing import Literal, get_args

from ._cdn import CHROMA, H3, SS
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

METHOD = Literal["jenks", "quantile", "equal", "heads"]
AGG = Literal["count", "sum", "avg", "min", "max"]


class HeatmapControl(BaseControl):
    """H3 hexbin heatmap with zoom-adaptive resolution and labeled hexagons.

    .. note::

        Only markers with a ``.feature`` property (GeoJSON / ``df.explore``) are
        counted. Annotation or label markers without ``.feature`` are skipped to avoid
        double-counting in hexbin aggregation.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

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

    style : dict, optional
        Grid style overrides. Supported keys:

        - ``field`` (optional)
          property name to aggregate on. ``null`` / ``"auto"`` counts features per
          hexagon; any other string aggregates that numeric property.

        - ``border_weight`` (float, default 1.5)
          border width

        - ``border_color`` (str, default "#333333")
          border color

        - ``fill_opacity`` (float, default 0.7)
          fill opacity

        - ``border_opacity`` (float, default 0.9)
          border opacity

        - ``label_show`` (bool, default True)
          show aggregated value at hex center

        - ``label_size`` (int, default 11)
          label font size

        - ``label_color`` (str, default "#fff")
          label color

        - ``label_format`` (str, default "auto")
          number format: ``"auto"`` (10K/1K suffix), ``"int"``, ``"comma"``
          (thousands separator)

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import HeatmapControl
    >>> m = folium.Map()
    >>> HeatmapControl().add_to(m)
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

    def __init__(
        self,
        *,
        position: Position = "topleft",
        color_scheme: str = "Reds",
        method: METHOD = "jenks",
        n_classes: int = 6,
        agg: AGG = "count",
        schemes: list[str] | None = None,
        style: dict | None = None,
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

        super().__init__(position=position, locale=locale)
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
        self.style = {
            "border_weight": 1.5,
            "border_color": "#333333",
            "fill_opacity": 0.7,
            "border_opacity": 0.9,
            "label_show": True,
            "label_size": 11,
            "label_color": "#fff",
            "label_format": "auto",
        } | (style or {})
        self._template = self._get_template(
            js_file="HeatmapControl.js", css_file="HeatmapControl.css"
        )
