from __future__ import annotations

from typing import Annotated

from branca.element import Element
from folium.map import Layer

from foliplus._config_schema import FieldSpec
from foliplus._declaration import FILTER_KEY
from foliplus._typing import ControlPosition
from foliplus.BaseControl import BaseControl
from foliplus.locale import LocaleConfig

from ._fill_author import fill_author, map_colormaps
from ._layer_declaration import declared_filter, declared_folder, declared_zoom_range


class LayerControl(BaseControl):
    """Layer panel to organize, inspect, style, and filter map layers.

    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering within a section, synced to Leaflet render
      order.
    - ✅ Multi-select checkboxes with z-index stacking, plus a toggle for all
      layers in a section.
    - 🎨 Solid-color replacement for base maps.
    - 🎨 Fill by value: color a layer by a numeric field with a classification
      method, class count, and scheme, use a single fill color, or keep the
      layer's own per-feature paint as the read-only original.
    - 🧰 Per-layer style drawer: opacity, zoom range, border, fill, size, and
      text labels with color, size, number format, and overlap control.
    - 🔎 Filter a layer's features live: a range on a numeric field, or a set
      of values on a categorical one, with a kept/total readout and a Clear
      action.
    - 🗂️ Row actions: rename, attributes, style, filter, and delete or clear
      with confirmation.
    - 💾 Panel state (order, visibility, folds, names, styles) persists across
      reloads.
    - 🏷️ Per-layer text labels via ``foliplus={"label": {"field": ...}}`` on
      the layer itself.
    - ⌨️ Keyboard navigation across rows and panels (see the shortcuts table
      below).
    - 🎯 Zoom the map to a layer's extent (double-click / ⋮ / Alt+Enter).

    Shortcuts
    ---------

    Focus a layer row by clicking it, then use:

    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Key              | Action                                                                                                                   |
    +==================+==========================================================================================================================+
    | ArrowUp          | Move focus to previous layer                                                                                             |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | ArrowDown        | Move focus to next layer                                                                                                 |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | ArrowLeft        | Toggle visibility of focused layer (deselect)                                                                            |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | ArrowRight       | Toggle visibility of focused layer (select)                                                                              |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Space            | Toggle visibility of focused layer                                                                                       |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Enter            | Toggle visibility of focused layer                                                                                       |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Ctrl+Up          | Move focused layer one position up                                                                                       |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Ctrl+Down        | Move focused layer one position down                                                                                     |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Escape           | Close the open rename, menu, attributes, filter, or style panel; otherwise cancel focus and clear the keyboard cursor    |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Double-click row | Zoom the map to that layer's extent (dashed rect). Hidden layers show a hint instead. Also from the ⋮ menu or Alt+Enter. |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | Alt+Enter        | Zoom to the focused layer (same as double-click)                                                                         |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+
    | ⋮ menu           | Enter or Space activates the focused item, Tab moves between items, Escape closes the menu                               |
    +------------------+--------------------------------------------------------------------------------------------------------------------------+

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
    Mount the panel on a map:

    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)

    A layer may declare its own defaults on the layer itself, in the same
    ``foliplus=`` namespace the fill and label declarations use. Declare a
    visible zoom range:

    >>> import geopandas as gpd
    >>> gdf = gpd.read_file("boundaries.geojson")
    >>> m = gdf.explore(foliplus={"zoom_range": {"min": 8, "max": 12}})
    >>> LayerControl().add_to(m)

    Declare per-layer text labels:

    >>> gdf.explore(foliplus={"label": {"field": "name", "collide": False}})

    Declare a value-based fill that classifies each feature at load:

    >>> gdf.explore(foliplus={"fill": {"field": "score", "scheme": "Reds"}})

    Notes
    -----
    Recognised keys:

    +----------------+------+------------------------------------------------------------------+
    | Key            | Type | Meaning                                                          |
    +================+======+==================================================================+
    | ``fill``       | dict | the layer's value-based fill (see the fill table below).         |
    +----------------+------+------------------------------------------------------------------+
    | ``label``      | dict | The layer's text labels (see the label table below).             |
    +----------------+------+------------------------------------------------------------------+
    | ``zoom_range`` | dict | The layer's visible zoom range (see the zoom range table below). |
    +----------------+------+------------------------------------------------------------------+
    | ``folder``     | str  | The layer's folder (section group) name; see the note below.     |
    +----------------+------+------------------------------------------------------------------+

    Two layers declaring the same ``folder`` name in the same section and
    role (for example ``foliplus={"folder": "底图"}``) are grouped into one
    folder — a grouping intent, not a conflict, and it never warns.

    Folder names group case-insensitively after whitespace folding, so
    ``"Basemap"``, ``"basemap"`` and ``"BASE MAP"`` land in one folder.
    The folder keeps the first spelling it saw (trimmed) as its display
    name.

    A folder keeps its group row after its last layer is removed, so you
    can still drag more layers into it.

    Third-party layers and components:

    A third-party or custom :class:`folium.map.Layer` subclass can declare a
    folder the same way foliplus layers do, through the same
    ``foliplus={"folder": "..."}`` namespace:

    >>> gdf.explore(foliplus={"folder": "底图"})

    The same rules apply: a non-string or blank ``folder`` warns once and is
    ignored (the layer stays at the section root), and two layers declaring
    the same folder name in the same section and role are grouped into one
    folder. On the JavaScript side, a third-party component can declare its
    folder through ``LayerAPI.registerLayer``.

    The ``fill`` declaration keys:

    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+
    | Key         | Default                                         | Meaning                                                                                                                                                            |
    +=============+=================================================+====================================================================================================================================================================+
    | ``field``   | required — naming one turns value-based fill on | the numeric or categorical feature property to classify                                                                                                            |
    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+
    | ``kind``    | inferred from the layer's own values            | the variant (``numeric`` / ``category``); when omitted the layer's values are sampled, and a field that mixes value kinds or has no usable value drops it          |
    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+
    | ``method``  | ``jenks``                                       | classification method (``jenks`` / ``quantile`` / ``equal`` / ``heads``)                                                                                           |
    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+
    | ``classes`` | ``6``                                           | number of classes, an integer from 2 to 9 (the panel's maximum)                                                                                                    |
    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+
    | ``scheme``  | ``Viridis`` (``Set3`` for a category variant)   | palette name (the style panel's own candidates)                                                                                                                    |
    +-------------+-------------------------------------------------+--------------------------------------------------------------------------------------------------------------------------------------------------------------------+

    How a ``fill`` declaration is resolved:

    +-------------------------------+--------------------------------------------------------------+
    | Condition                     | Behaviour                                                    |
    +===============================+==============================================================+
    | User stored mode              | The row shows the stored mode; it always wins.               |
    +-------------------------------+--------------------------------------------------------------+
    | Valid declaration             | The declared ramp classifies each feature by field at load   |
    |                               | (it does not flatten the layer to a single color); the row   |
    |                               | opens on it and Reset returns to it.                         |
    +-------------------------------+--------------------------------------------------------------+
    | No declaration                | The row shows the detected per-feature state, else the       |
    |                               | built-in fallback.                                           |
    +-------------------------------+--------------------------------------------------------------+
    | Invalid declaration           | Degrades key by key (each rejected key warns once, the rest  |
    |                               | survives); a declaration without a usable field drops whole  |
    |                               | and falls back to the per-feature paint / built-in.          |
    +-------------------------------+--------------------------------------------------------------+

    Value-based fill needs an areal geometry. Polygons (``Polygon``,
    ``MultiPolygon``, ``Rectangle``) and circles (``Circle``,
    ``CircleMarker``) repaint by value; a ``Polyline`` takes a stroke
    colour instead, so value-based stroke is a known gap; and a marker is
    an icon, which has no fill to repaint.

    The ``label`` declaration keys:

    +-------------+-------------------------------------+--------------------------------------------------------------+
    | Key         | Default                             | Meaning                                                      |
    +=============+=====================================+==============================================================+
    | ``field``   | labels stay off                     | the feature property to label; declaring it turns labels on  |
    +-------------+-------------------------------------+--------------------------------------------------------------+
    | ``format``  | ``auto``                            | number format (``auto`` / ``int`` / ``comma`` / ``percent``) |
    +-------------+-------------------------------------+--------------------------------------------------------------+
    | ``color``   | ``#ffffff``                         | label color; hex only, ``#rgb`` is normalised to ``#rrggbb`` |
    +-------------+-------------------------------------+--------------------------------------------------------------+
    | ``size``    | ``11`` px                           | label font size in px, clamped to the panel's 6-32 range     |
    +-------------+-------------------------------------+--------------------------------------------------------------+
    | ``collide`` | page-level ``label_collide``        | whether this layer's labels take part in overlap avoidance   |
    +-------------+-------------------------------------+--------------------------------------------------------------+
    | ``show``    | ``True`` once ``field`` is declared | explicit on/off, so a field can be named without drawing     |
    +-------------+-------------------------------------+--------------------------------------------------------------+

    The ``zoom_range`` declaration keys:

    +---------+------+----------+--------------------------------------------------------------+
    | Key     | Type | Required | Meaning                                                      |
    +=========+======+==========+==============================================================+
    | ``min`` | int  | yes      | Lowest zoom at which the layer is visible (inclusive).       |
    +---------+------+----------+--------------------------------------------------------------+
    | ``max`` | int  | yes      | Highest zoom at which the layer is visible (inclusive).      |
    +---------+------+----------+--------------------------------------------------------------+

    How a ``zoom_range`` declaration is resolved:

    +-------------------------------+--------------------------------------------------------------+
    |Condition                      |Behaviour                                                     |
    +===============================+==============================================================+
    |User stored range              |The row shows the stored range; it always wins.               |
    +-------------------------------+--------------------------------------------------------------+
    |Valid declaration              |The row opens on it and Reset returns to it.                  |
    +-------------------------------+--------------------------------------------------------------+
    |No declaration                 |The row opens on the map's own range.                         |
    +-------------------------------+--------------------------------------------------------------+
    |Declared range cannot meet the |Treated as undeclared: the layer stays visible at every level,|
    |map's zoom levels              |the degradation warns once, and the row stays editable (it    |
    |                               |shows the stored value, else the map's range).                |
    +-------------------------------+--------------------------------------------------------------+
    |Malformed declaration (missing |Warns once and is treated as undeclared; never hides the      |
    |key, non-int, inverted, unknown|layer.                                                        |
    |key)                           |                                                              |
    +-------------------------------+--------------------------------------------------------------+

    A declaration is a default, never a rewrite: it does not modify the
    layer's own data.

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
                        # Optional: what Python computed for the author's
                        # per-feature paint (explore's baked colors). The panel
                        # reads it as the author default behind fill by value;
                        # absent on a layer with no author paint.
                        "fillAuthor": (
                            {
                                "perFeature": "bool",
                                "distinct": "number",
                                "stops": "array_string",
                                "capped": ("bool", "?"),
                                # The scale the author mounted (continuous) or
                                # the classified blocks they drew (stepped).
                                "scale": (
                                    {
                                        "kind": ("continuous", "stepped"),
                                        "column": ("string", "?"),
                                        "vmin": ("number", "?"),
                                        "vmax": ("number", "?"),
                                        "levels": ("number", "?"),
                                        "method": (("equal", "null"), "?"),
                                    },
                                    "?",
                                ),
                            },
                            "?",
                        ),
                        # Optional: the author-declared zoom range,
                        # normalised from foliplus={"zoom_range": {...}}.
                        # Absent when the layer declares none - the
                        # visibility policy then keeps the map range.
                        "zoomRange": (
                            {"min": "number", "max": "number"},
                            "?",
                        ),
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
            ``{"data": [{"name", "id", "role", "show"}, ...]}`` with optional
            ``fillAuthor`` / ``zoomRange`` — the ``data`` key is merged into the JS
            ``CONFIG`` object by :meth:`BaseControl._build_config`.
        """
        data: list[dict[str, object]] = []
        seen: set[str] = set()
        candidates: list[Element] = [*self._children.values()]
        if (parent := self._parent) is not None:
            candidates += [*parent._children.values()]
        # The explore scales live on the map, not on the layer: read them once
        # for the whole pass, from the control's own parent chain (see
        # map_colormaps). ``claimed`` keeps one scale per layer.
        colormaps = map_colormaps(self)
        claimed: set[int] = set()

        for item in candidates:
            # isinstance first — the control itself is a child but not a Layer
            # (and has no `.control` attribute).
            if not isinstance(item, Layer) or not item.control:
                continue
            if (name := item.get_name()) in seen:
                continue
            seen.add(name)

            entry: dict[str, object] = {
                "name": item.layer_name,
                "id": name,
                "role": "overlay" if item.overlay else "base",
                "show": bool(item.show),
            }
            author = fill_author(item, colormaps, claimed)
            if author is not None:
                entry["fillAuthor"] = author
            zoom_range = declared_zoom_range(item, item.layer_name)
            if zoom_range is not None:
                entry["zoomRange"] = zoom_range
            folder = declared_folder(item, item.layer_name)
            if folder is not None:
                entry["folder"] = folder
            filter_decl = declared_filter(item, item.layer_name)
            if filter_decl is not None:
                entry[FILTER_KEY] = filter_decl
            data.append(entry)

        # A folder name shared by several layers is a grouping intent, not a
        # conflict: the JS side merges same-name declarations of the same role
        # into one authorFolderId (folder = section group name, one group may
        # hold many member rows). Each declaring layer simply emits the name.

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: d["role"] == "base")
        return {"data": data}
