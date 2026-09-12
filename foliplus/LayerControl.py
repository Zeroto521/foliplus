from __future__ import annotations

from typing import cast

from folium.elements import Element
from folium.map import Layer

from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig


class LayerControl(BaseControl):
    """Layer panel to organize, inspect, and zoom to map layers.

    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering, synced to Leaflet render order.
    - ✅ Multi-select checkboxes with z-index stacking.
    - 🎨 Color picker to replace base maps with a solid background color.
    - ⌨️ Keyboard navigation (see Shortcuts below).
    - 🎯 Zoom the map to a layer's extent (double-click / ⋮ / Alt+Enter).

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - ArrowUp
         - Move focus to previous layer
       * - ArrowDown
         - Move focus to next layer
       * - ArrowLeft
         - Toggle visibility of focused layer (deselect)
       * - ArrowRight
         - Toggle visibility of focused layer (select)
       * - Space
         - Toggle visibility of focused layer
       * - Enter
         - Toggle visibility of focused layer
       * - Ctrl+Up
         - Move focused layer one position up
       * - Ctrl+Down
         - Move focused layer one position down
       * - Escape
         - Clear focus
       * - Double-click row
         - Zoom the map to that layer's extent (dashed rect). Hidden layers
           show a hint instead. Also from the ⋮ menu or Alt+Enter.
       * - Alt+Enter
         - Zoom to the focused layer (same as double-click)

    On macOS, Cmd acts as the modifier key instead of Ctrl.

    Base basemap, color picker, and hidden rows stay quiet: no cursor glow
    on click or keyboard focus. Their ⋮ "Focus layer" item is disabled
    (not-allowed cursor) — toggle visibility from the checkbox as usual.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)
    """

    def __init__(
        self,
        *,
        position: Position = "topleft",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self._template = self._get_template()

    def _extra_config(self) -> dict:
        """Collect layers from the parent map at render time.

        This is the canonical example of a control that needs render-time data the
        constructor cannot know: the layer list only exists once the control is added
        to a map. Layers may be attached to the control itself (the usual case, since
        ``.add_to(control)`` is how layers are grouped for display) or to the parent
        map (the historical case). Candidates from both are unioned and deduplicated
        by ``get_name()``, because folium's ``add_child`` stores elements in an
        ``OrderedDict`` under that name — the same ``Layer`` reached twice collapses
        to one key, distinct layers never collide.

        Returns
        -------
        dict
            ``{"data": [{"name", "id", "isBase"}, ...]}`` — the ``data`` key is merged
            into the JS ``CONF`` object by :meth:`BaseControl._build_config`.
        """
        data: list[dict[str, object]] = []
        seen: set[str] = set()
        candidates: list[Element] = [*self._children.values()]
        if (parent := self._parent) is not None:
            candidates += [*parent._children.values()]

        for item in candidates:
            # isinstance first — the control itself is a child but not a Layer
            # (and has no `.control` attribute).
            if not isinstance(item, Layer) or not item.control:
                continue
            if (name := item.get_name()) in seen:
                continue
            seen.add(name)

            data.append(
                {
                    "name": item.layer_name,
                    "id": name,
                    "isBase": not item.overlay,
                }
            )

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: cast(bool, d["isBase"]))
        return {"data": data}
