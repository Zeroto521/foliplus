from __future__ import annotations

from foliplus._typing import ControlPosition
from foliplus.BaseControl import BaseControl
from foliplus.locale import LocaleConfig


class FullscreenControl(BaseControl):
    """Fullscreen toggle with auto-hide for other controls.

    When toggling fullscreen, other controls (HeatmapControl, LayerControl, ScaleControl,
    SearchControl, MeasureControl, etc.), inside ``.leaflet-control-container`` are
    automatically hidden/shown for a cleaner view.

    Parameters
    ----------
    position : str, default "bottomright"
        One of "topleft", "topright", "bottomleft", "bottomright".

    hide_self : bool, default True
        Whether to hide the fullscreen button itself after entering fullscreen.
        Users can exit via the ``Esc`` key. Only the fullscreen button is
        hidden: the bar's zoom buttons stay visible, so the map can still be
        zoomed while fullscreen.

    hide_others : bool, default True
        Whether to hide other map controls after entering fullscreen.

    .. note::
        The map's own Leaflet zoom control is left untouched: this control does
        not replace, copy or remove it. While fullscreen, ``hide_others`` hides
        it like every other control, while the bar's own zoom buttons remain.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import FullscreenControl
    >>> m = folium.Map()
    >>> FullscreenControl().add_to(m)
    """

    def __init__(
        self,
        *,
        position: ControlPosition = "bottomright",
        hide_self: bool = True,
        hide_others: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.hide_self = hide_self
        self.hide_others = hide_others
