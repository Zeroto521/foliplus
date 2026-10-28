from __future__ import annotations

from typing import Annotated

from branca.element import Element
from folium.map import Layer

from ._config_schema import FieldSpec
from ._typing import ControlPosition
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

    label_collide : bool, default True
        Page-wide default for the per-layer "avoid overlap" setting: when
        enabled, a layer's own labels thin themselves out where they overlap.
        Labels from *different* layers never avoid each other — the layers are
        stacked, so an upper layer simply covers the lower one's. The style
        panel overrides this per layer.

    collapse_on_outside : bool, default False
        Whether a press outside the panel collapses it. Off by default: the
        panel is a working surface read at the same time as the map, and the
        map's busiest gesture is drag-pan / click-select. The header close
        button collapses it explicitly either way.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)

    Notes
    -----
    A layer may declare its own label defaults on the layer itself:

    >>> gdf.explore(
    ...     foliplus={"label": {"field": "name", "collide": False}}
    ... )

    ``label`` is the only namespace key read. The pre-rename ``annotation``
    spelling is ignored — it is not read, not warned about and not migrated.

    .. list-table::
       :header-rows: 1

       * - Key
         - Default
         - Meaning
       * - ``field``
         - labels stay off
         - the feature property to label; declaring it turns labels on
       * - ``format``
         - ``auto``
         - number format (``auto`` / ``int`` / ``comma`` / ``percent``)
       * - ``color``
         - ``#ffffff``
         - label colour; hex only, ``#rgb`` is normalised to ``#rrggbb``
       * - ``size``
         - ``11`` px
         - label font size in px, clamped to the panel's 6-32 range
       * - ``collide``
         - page-level ``label_collide``
         - whether this layer's labels take part in overlap avoidance
       * - ``show``
         - ``True`` once ``field`` is declared
         - explicit on/off, so a field can be named without drawing

    Keys stay short because the declaration's own namespace already says
    label; the ``label_`` prefix belongs to the flat surfaces (Python
    kwargs, CONF, locale). A declaration is the author's default: a later
    choice in the style panel is the user's intent and wins, and Reset
    shows the declaration through again.
    """

    # Emitted by _extra_config at render time rather than set by a constructor
    # parameter, so it is declared here instead of in __init__ — declared the
    # same way a parameter is, with its alias name and shape in the FieldSpec.
    _dynamic_fields = {
        "data": Annotated[
            list,
            FieldSpec(
                name="LayerData",
                shape=[
                    {
                        "name": "string",
                        "id": "string",
                        "role": ("base", "overlay"),
                        "show": "bool",
                    }
                ],
            ),
        ]
    }

    def __init__(
        self,
        *,
        position: ControlPosition = "topleft",
        label_collide: bool = True,
        collapse_on_outside: bool = False,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.label_collide = label_collide
        self.collapse_on_outside = collapse_on_outside

    def _extra_config(self) -> dict[str, object]:
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
            ``{"data": [{"name", "id", "role"}, ...]}`` — the ``data`` key is merged
            into the JS ``CONFIG`` object by :meth:`BaseControl._build_config`.
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
                    "role": "overlay" if item.overlay else "base",
                    "show": bool(item.show),
                }
            )

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: d["role"] == "base")
        return {"data": data}
