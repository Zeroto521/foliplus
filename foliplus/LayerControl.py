from __future__ import annotations

from typing import Optional, Union

from folium import LayerControl as FoliumLayerControl

from ._typing import Position
from .base import BaseControl
from .locale import LocaleConfig


class LayerControl(FoliumLayerControl, BaseControl):
    """Enhanced layer control with geometry-type icons, drag-and-drop ordering,
    and a collapsible panel.

    Replaces Folium's default layer control with:
    - Geometry-type icons (point / line / polygon / base map) for each layer.
    - Overlay and base map layers displayed in separate groups.
    - Drag-and-drop overlay reordering, synced to Leaflet render order.
    - Radio-button toggle for base maps (mutually exclusive).
    - Collapsible panel consistent with other foliplus controls.

    Parameters
    ----------
    position : str, default "topleft"
        Control position. One of ``"topleft"``, ``"topright"``,
        ``"bottomleft"``, ``"bottomright"``.

    locale : LocaleConfig, optional
        Localization configuration. Defaults to English.

    **kwargs
        Extra keyword arguments forwarded to :class:`folium.LayerControl`.

    Notes
    -----
    This control overrides the parent ``_template`` to inject custom CSS and
    JavaScript via Jinja2. Layer identification relies on ``map._layers`` and
    the ``window`` global variable.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)
    """

    def __init__(
        self,
        position: Position = "topleft",
        locale: Optional[Union[str, LocaleConfig]] = None,
        **kwargs,
    ):
        FoliumLayerControl.__init__(self, position=position, **kwargs)
        BaseControl.__init__(self, position=position, locale=locale)
        self._template = self._get_template(
            js_file="LayerControl.js", css_file="LayerControl.css", use_panel=True
        )
