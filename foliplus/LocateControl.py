from __future__ import annotations

from ._cdn_loader import load_cdn
from ._typing import Position, Zoom
from ._validate import validate
from .BaseControl import BaseControl
from .locale import LocaleConfig


class LocateControl(BaseControl):
    """Fly to the user's current position.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    zoom : int, default 15
        Zoom level after locating, between 1 and 18.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LocateControl
    >>> m = folium.Map()
    >>> LocateControl().add_to(m)
    """

    _export_fields = ("zoom",)

    default_js = load_cdn("LocateControl")

    @validate
    def __init__(
        self,
        *,
        position: Position = "bottomright",
        zoom: Zoom = 15,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.zoom = zoom
        self._template = self._get_template()
