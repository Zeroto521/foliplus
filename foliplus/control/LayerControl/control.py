from __future__ import annotations

from typing import Annotated, Literal, get_args

from branca.element import Element
from folium.map import Layer

from foliplus._config_schema import FieldSpec
from foliplus._declaration import FILTER_KEY
from foliplus._typing import ControlPosition
from foliplus.BaseControl import BaseControl
from foliplus.locale import LocaleConfig

from ._fill_author import fill_author, map_colormaps
from ._layer_declaration import (
    declared_border,
    declared_filter,
    declared_folder,
    declared_icon_size,
    declared_marker_color,
    declared_zoom_range,
)
from ._role import LayerRole, layer_role


class LayerControl(BaseControl):
    """Layer panel to organize, inspect, style, and filter map layers.

    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering within a role, synced to Leaflet render
      order.
    - ✅ Multi-select checkboxes with z-index stacking, plus a toggle for all
      layers in a role.
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

    icon_prefix : Literal["fa-solid", "fa-regular"], default "fa-solid"
        FontAwesome family class prefix used when the panel renders a glyph
        picker icon or probes its availability. A layer whose author declared
        its own prefix (`folium.map.Icon(prefix=...)`) keeps that prefix; this
        control-level value is the fallback for every other layer. The
        control only supports FontAwesome's solid and regular families
        (the only two in the glyph table); another family needs its own
        glyph table and is a separate task.

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

    The per-layer declaration namespace is documented in :doc:`/guide/declaration`.
    The keys are:

    .. list-table::
       :widths: 16 6 62
       :header-rows: 1

       * - Key
         - Type
         - Meaning
       * - ``fill``
         - dict
         - the layer's value-based fill (field + optional method/classes/scheme/kind).
       * - ``label``
         - dict
         - the layer's text labels (field + optional format/color/size/collide/show).
       * - ``zoom_range``
         - dict
         - the layer's visible zoom range (``min`` / ``max``).
       * - ``folder``
         - str
         - the layer's folder (role) name.
       * - ``border``
         - dict
         - the border default mode (mode-shell or flat value form).
       * - ``marker_color``
         - str
         - the marker chassis preset name.
       * - ``icon_size``
         - int
         - the marker icon pixel size.

    Two layers declaring the same ``folder`` name in the same role (for
    example ``foliplus={"folder": "底图"}``) are grouped into one
    folder — a grouping intent, not a conflict, and it never warns.

    Folder names group case-insensitively after whitespace folding, so
    ``"Basemap"``, ``"basemap"`` and ``"BASE MAP"`` land in one folder.
    The folder keeps the first spelling it saw (trimmed) as its display
    name.

    A folder keeps its group row after its last layer is removed, so you
    can still drag more layers into it.

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
                        "role": get_args(LayerRole),
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
        icon_prefix: Literal["fa-solid", "fa-regular"] = "fa-solid",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.label_collide = label_collide
        self.collapse_on_outside = collapse_on_outside
        self.icon_prefix = icon_prefix

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
                # folium.overlay <-> foliplus role: the single mapping point
                # (see _role.py). overlay=True is a data layer, False a basemap.
                "role": layer_role(item),
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
            # A border declaration is read by the JS panel straight off
            # layer.options.foliplus (same channel as fill/label). Python's
            # only job here is the shape validation + one-time warning: a
            # malformed border warns at collection time instead of silently
            # painting a mode the author never saw validated.
            declared_border(item, item.layer_name)
            # Marker chassis colour and icon pixel size ride the same channel
            # as border: the JS panel reads them straight off
            # layer.options.foliplus (via the shared declared-key reader), so
            # Python's only job is shape validation + one-time warning at
            # collection time - a malformed declaration warns here instead of
            # silently scaling/painting a value the author never saw
            # validated. Neither emits a CONF fact; each is read per layer.
            declared_marker_color(item, item.layer_name)
            declared_icon_size(item, item.layer_name)
            data.append(entry)

        # A folder name shared by several layers is a grouping intent, not a
        # conflict: the JS side merges same-name declarations of the same role
        # into one authorFolderId (folder = role name, one role may
        # hold many member rows). Each declaring layer simply emits the name.

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: d["role"] == "base")
        return {"data": data}
