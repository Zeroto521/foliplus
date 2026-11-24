from __future__ import annotations

from typing import Annotated, Any, Literal

from foliplus._config_schema import FieldSpec
from foliplus._typing import ControlPosition
from foliplus.BaseControl import BaseControl
from foliplus.locale import LocaleConfig

from ._collect import collect_layer_data
from ._folder import normalise_folders
from ._role import normalise_role_defaults
from ._spec import LAYER_DATA_FIELDS


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

    folders : dict, optional
        Central folder-defaults config: author-declared default folded state
        per folder, keyed by role (multiple folders per role — hence the
        plural ``folders``, unlike the per-layer ``foliplus={"folder": ...}``
        which is singular because one layer belongs to one folder). Entries
        are ``{"name": ..., "folded": ...}``; only ``name`` is required (a
        non-empty string), ``folded`` is an optional bool (default expanded).
        A name may be declared even with no members yet. A user manual
        fold always wins over the author default; an explicit expand over an
        author-folded folder is not yet supported, because the user override is
        a set of folded keys and cannot record "the user re-expanded this".
        Declarations of the same name (NFC → whitespace-fold → trim →
        lower-case) merge within one section: the display name keeps the first
        spelling, ``folded`` is last-wins.

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
         - the fill default: a value mode (field + optional
           method/classes/scheme/kind) or a solid mode (color + opacity);
           ``mode`` may name ``solid`` / ``value`` / ``original``.
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
         - the border default: a mode-shell (``follow_fill`` / ``value`` /
           ``solid`` / ``original``) or the flat value form, plus optional
           ``color`` (solid mode) and ``weight`` (any mode).
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

    How a ``zoom_range`` declaration is resolved:

    - A user stored range always wins: the row shows it and it never changes.
    - A valid declaration: the row opens on it and Reset returns to it.
    - No declaration: the row opens on the map's own range.
    - A declared range the map cannot meet: Treated as undeclared, the layer
      stays visible at every level, the degradation warns once, and the row
      stays editable (it shows the stored value, else the map's range).
    - A malformed declaration (missing key, non-int, inverted, unknown key):
      Warns once and is treated as undeclared; never hides the layer.

    A declaration is a default, never a rewrite: it does not modify the
    layer's own data.

    """

    # Emitted by _extra_config at render time rather than set by a constructor
    # parameter, so it is declared here instead of in __init__ — declared the
    # same way a parameter is, with its alias name and shape in the FieldSpec.
    _dynamic_fields = LAYER_DATA_FIELDS

    def __init__(
        self,
        *,
        position: ControlPosition = "topleft",
        label_collide: bool = True,
        collapse_on_outside: bool = False,
        icon_prefix: Literal["fa-solid", "fa-regular"] = "fa-solid",
        folders: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="FolderDefaults",
                name="FolderDefaults",
                shape={
                    "overlay": [{"name": "string", "folded": ("bool", "?")}],
                    "base": [{"name": "string", "folded": ("bool", "?")}],
                },
                config_key="folders",
                note=(
                    "Central folder-defaults config: author-declared default "
                    "folded state per folder, keyed by role. Entries are "
                    "{name, folded}; a name may be declared even with no "
                    "members yet. A user manual fold always wins over the "
                    "author default; same-name declarations merge (first "
                    "spelling, folded last-wins).",
                ),
            ),
        ] = None,
        roles: Annotated[
            dict[str, Any] | None,
            FieldSpec(
                ts="RoleDefaults",
                name="RoleDefaults",
                shape={
                    "overlay": {"folded": ("bool", "?")},
                    "base": {"folded": ("bool", "?")},
                },
                config_key="roles",
                note=(
                    "Central role-defaults config: author-declared default "
                    "folded state per role. Entries are {folded}; an absent "
                    "role keeps the built-in expanded default. A user manual "
                    "fold or expand always wins over the author default.",
                ),
            ),
        ] = None,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.label_collide = label_collide
        self.collapse_on_outside = collapse_on_outside
        self.icon_prefix = icon_prefix
        # The author writes folders={"overlay": [...], "base": [...]}; CONF
        # carries the normalised {name, folded} lists under the shared
        # `folders` key. Invalid declarations warn once and stay None (every
        # folder keeps the built-in expanded default).
        self.folders = normalise_folders(folders)
        # The author writes roles={"overlay": {"folded": True}, ...}; CONF
        # carries the normalised {folded} mappings under the shared `roles`
        # key. Invalid declarations warn once and stay None (every role keeps
        # the built-in expanded default).
        self.roles = normalise_role_defaults(roles)

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
        return collect_layer_data(self)
