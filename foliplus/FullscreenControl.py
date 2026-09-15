from __future__ import annotations

from ._typing import Position
from ._validate import validate
from .BaseControl import BaseControl
from .locale import LocaleConfig


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
        Users can exit via the ``Esc`` key.

    hide_others : bool, default True
        Whether to hide other map controls after entering fullscreen.

    hide_selector : list of str, optional
        Extra CSS selectors to hide on the page while in fullscreen, beyond the
        map controls that ``hide_others`` already covers — e.g. a page navbar
        or footer that sits outside ``.leaflet-control-container``.

        Elements are hidden by ``display: none`` and restored to their original
        style when fullscreen exits, so a navbar that was already hidden for
        another reason stays hidden.

        Selectors that match nothing are ignored without failing the control.
        An invalid selector is reported once to the browser console and skipped,
        so a typo does not silently disable the rest of the list. Selectors are
        user code: ``.nav button`` and ``.nav[data-open]`` behave differently
        depending on whether their own stylesheet is specific enough to win.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import FullscreenControl
    >>> m = folium.Map()
    >>> FullscreenControl().add_to(m)
    >>> FullscreenControl(hide_selector=[".site-navbar", "#app-header"]).add_to(m)
    """

    _export_fields = ("hide_self", "hide_others", "hide_selector")

    @validate
    def __init__(
        self,
        *,
        position: Position = "bottomright",
        hide_self: bool = True,
        hide_others: bool = True,
        hide_selector: list[str] | None = None,
        locale: str | LocaleConfig | None = None,
    ):
        if hide_selector is not None and not isinstance(hide_selector, (list, tuple)):
            raise ValueError(
                f"hide_selector must be a list of str or None, got {hide_selector!r}"
            )
        super().__init__(position=position, locale=locale)
        self.hide_self = hide_self
        self.hide_others = hide_others
        self.hide_selector = list(hide_selector or ())
        self._template = self._get_template()
