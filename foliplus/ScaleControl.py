from __future__ import annotations

from .BaseControl import BaseControl
from .locale import LocaleConfig


class ScaleControl(BaseControl):
    """Scale bar with metric units and optional zoom level display.

    Parameters
    ----------
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

    _export_fields = ("show_zoom",)

    def __init__(
        self,
        *,
        show_zoom: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position="bottomleft", locale=locale)
        self.show_zoom = show_zoom
        self._template = self._get_template()
