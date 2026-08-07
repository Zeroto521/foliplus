from __future__ import annotations

from typing import Literal, get_args

from .BaseControl import BaseControl
from .locale import LocaleConfig

Unit = Literal["metric", "imperial"]


class ScaleControl(BaseControl):
    """Scale bar with metric or imperial units and optional zoom level display.

    Parameters
    ----------
    unit : str, default ``"metric"``
        Unit system: ``"metric"`` (meters / kilometers) or ``"imperial"`` (miles / feet).

    show_zoom : bool, default True
        Whether to show the current map zoom level.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import ScaleControl
    >>> m = folium.Map()
    >>> ScaleControl().add_to(m)
    """

    def __init__(
        self,
        *,
        unit: Unit = "metric",
        show_zoom: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        if unit not in get_args(Unit):
            raise ValueError(f"unit must be {get_args(Unit)}, got {unit!r}")

        super().__init__(position="bottomleft", locale=locale)
        self.unit = unit
        self.show_zoom = show_zoom
        self._template = self._get_template(
            config={
                "position": "bottomleft",
                "isMetric": unit == "metric",
                "show_zoom": show_zoom,
            },
        )
