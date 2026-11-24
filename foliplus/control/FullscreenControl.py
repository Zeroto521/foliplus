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
        hidden: the bar's zoom buttons stay visible, because Leaflet's own
        zoom control is replaced (see ``replace_zoom``) and hiding both would
        leave a fullscreen map with no way to zoom.

    hide_others : bool, default True
        Whether to hide other map controls after entering fullscreen.

    replace_zoom : bool, default True
        Whether to remove Leaflet's zoom control, replacing it with the bar's
        own zoom buttons. The bar's buttons are the only zoom reachable while
        fullscreen (``hide_others`` hides ``.leaflet-control``), and outside
        fullscreen a second control would duplicate them. Pass ``False`` to
        keep Leaflet's zoom control as well.

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
        replace_zoom: bool = True,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.hide_self = hide_self
        self.hide_others = hide_others
        self.replace_zoom = replace_zoom
