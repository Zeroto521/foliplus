from __future__ import annotations

from foliplus.BaseControl import BaseControl
from foliplus._typing import ControlPosition
from foliplus.locale import LocaleConfig


class ScaleControl(BaseControl):
    """Scale bar with metric units and optional zoom level display.

    Parameters
    ----------
    position : str, default "bottomleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    show_zoom : bool, default True
        Whether to show the current map zoom level.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
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
        position: ControlPosition = "bottomleft",
        show_zoom: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.show_zoom = show_zoom
