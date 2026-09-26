"""StyleKitControl — restore style defaults and reset a map's saved settings."""

from __future__ import annotations

from ._cdn_loader import load_cdn
from ._typing import Position
from ._validate import validate
from .BaseControl import BaseControl
from .locale import LocaleConfig


class StyleKitControl(BaseControl):
    """Restore style defaults and reset this map's saved settings.

    A standalone control for the cross-layer style lifecycle:

    * **Restore defaults** — every layer's delegated style dimensions are
      called back to the values declared in Python.
    * **Reset this map's settings** — clears this map container's saved
      settings, so a reload returns to the Python-declared state.

    Saving a style record for later import is not part of this control.

    Parameters
    ----------
    position : str, default "bottomright"
        One of "topleft", "topright", "bottomleft", "bottomright".

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import StyleKitControl
    >>> m = folium.Map()
    >>> StyleKitControl().add_to(m)
    """

    default_js = load_cdn("StyleKitControl")

    @validate
    def __init__(
        self,
        *,
        position: Position = "bottomright",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template()
