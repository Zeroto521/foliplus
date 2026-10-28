from __future__ import annotations

import json
import math
import numbers
from typing import Annotated, Any, cast

from branca.element import Element
from folium import GeoJson
from folium.map import Layer

from ._config_schema import FieldSpec
from ._typing import ControlPosition
from .BaseControl import BaseControl
from .locale import LocaleConfig

_FOLIUM_COLOR_PROP = "__folium_color"
_FILL_AUTHOR_FIELD_LIMIT = 50
_FILL_AUTHOR_FEATURE_LIMIT = 50_000


def _fill_author_color(props: dict[str, Any]) -> str | None:
    """The feature's declarative colour, when explore wrote one."""
    color = props.get(_FOLIUM_COLOR_PROP)
    return color if isinstance(color, str) else None


def _geojson_data(item: Layer) -> dict[str, Any] | None:
    """The layer's GeoJson data as a mapping, or None when it is not one.

    folium accepts a mapping or a JSON string for the data; a broken string, a
    list of features or any other shape is not something this control describes,
    so it yields no author-fill metadata instead of failing the render.
    """
    if not isinstance(item, GeoJson):
        return None
    data = item.data
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def _feature_properties(feature: object) -> dict[str, Any] | None:
    """A feature's properties mapping, or None for a malformed feature."""
    props = feature.get("properties") if isinstance(feature, dict) else None
    return props if isinstance(props, dict) else None


def _collect_fill_author(
    features: list[Any],
) -> tuple[set[str], list[tuple[dict[str, Any], str]]]:
    """One pass over the features: the colour set and the coloured rows.

    A row is ``(properties, colour)``; only features that carry the property
    contribute, so a partially coloured layer still reports the colours it has.
    """
    colors: set[str] = set()
    rows: list[tuple[dict[str, Any], str]] = []
    for feature in features:
        props = _feature_properties(feature)
        if props is None:
            continue
        color = _fill_author_color(props)
        if color is None:
            continue
        colors.add(color)
        rows.append((props, color))
    return colors, rows


def _fill_author_value_kind(value: object) -> str | None:
    """How one feature property classifies a column: "int", "float", "string",
    or None when the value cannot key a mapping.

    ``numbers.Integral`` / ``numbers.Real`` rather than ``int`` / ``float``:
    GeoJson data assembled from a GeoDataFrame can carry numpy scalars, and
    ``np.int64`` registers as ``numbers.Integral`` without being ``int`` —
    testing the concrete builtins would silently drop every such column and
    send the panel back to its read-only per-feature state. ``bool`` is
    excluded explicitly (``np.bool_`` is neither Integral nor Real, so it
    falls through to None as well).
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, numbers.Integral):
        return "int"
    if isinstance(value, numbers.Real):
        # NaN is a missing value, not a class: a column that carries one
        # cannot key a value->colour mapping.
        return None if math.isnan(value) else "float"
    if isinstance(value, str):
        return "string"
    return None


def _fill_author_key(value: object, kind: str) -> str:
    """The mapping key for one value of the given kind.

    Integral values print as integers and real values as floats, so
    ``np.int64(10)`` and ``10`` share the key ``"10"`` while a float column
    keeps its ``10.0`` spelling (the documented key contract).
    """
    if kind == "int":
        return str(int(cast(numbers.Integral, value)))
    if kind == "float":
        return str(float(cast(numbers.Real, value)))
    return str(value)


def _fill_author_fields(
    rows: list[tuple[dict[str, Any], str]],
) -> list[dict[str, Any]]:
    """Candidate columns for the value-to-colour mapping, computed once.

    A column qualifies when every coloured feature carries it with a primitive
    value and each of its values maps to exactly one colour. Numeric values
    are normalized to one key spelling per kind (integral values print as
    integers, real values as floats), so numpy scalars and their Python
    builtin counterparts cannot split the same value into two entries, and
    NaN/None disqualify the column as a missing value. The mapping keeps the
    most frequent _FILL_AUTHOR_FIELD_LIMIT values; the rest are counted in
    other and flagged by truncated.
    """
    first_props = rows[0][0]
    candidates = [
        name
        for name, value in first_props.items()
        if not name.startswith("_") and _fill_author_value_kind(value) is not None
    ]
    fields: list[dict[str, Any]] = []
    for name in candidates:
        mapping: dict[str, str] = {}
        counts: dict[str, int] = {}
        values_by_key: dict[str, float] = {}
        numeric = True
        ok = True
        for props, color in rows:
            value = props.get(name)
            kind = _fill_author_value_kind(value)
            if kind is None:
                ok = False
                break
            if kind == "string":
                numeric = False
            key = _fill_author_key(value, kind)
            seen = mapping.get(key)
            if seen is not None and seen != color:
                ok = False
                break
            mapping[key] = color
            counts[key] = counts.get(key, 0) + 1
            if kind != "string":
                values_by_key[key] = float(cast(numbers.Real, value))
        if not ok or len(mapping) < 2:
            continue
        ordered = sorted(counts.items(), key=lambda entry: (-entry[1], entry[0]))
        kept = ordered[:_FILL_AUTHOR_FIELD_LIMIT]
        field: dict[str, Any] = {
            "name": name,
            "kind": "numeric" if numeric else "categorical",
            "mapping": {key: mapping[key] for key, _count in kept},
            "other": len(ordered) - len(kept),
            "truncated": len(ordered) > len(kept),
        }
        if numeric:
            # The author palette in value order: numeric fields are the
            # colour-by-value arm, so the client can draw the author scale and
            # start its own ramp from the same number of classes. Only the kept
            # values contribute, keeping the payload bounded.
            by_value = sorted(
                (values_by_key[key], mapping[key]) for key, _count in kept
            )
            ordered_colors: list[str] = []
            for _value, color in by_value:
                if color not in ordered_colors:
                    ordered_colors.append(color)
            field["orderedColors"] = ordered_colors
            field["classes"] = len(ordered_colors)
        fields.append(field)
    return fields


def _fill_author(item: Layer) -> dict[str, Any] | None:
    """Per-feature fill metadata for a folium GeoJson, from its features.

    Reads properties.__folium_color, which geopandas.explore writes for every
    feature; a style_function layer has no such property and returns None, so
    JavaScript keeps the normal single-colour arms for it. One pass over the
    features; above _FILL_AUTHOR_FEATURE_LIMIT features only the colour set is
    reported, so the payload stays bounded.
    """
    data = _geojson_data(item)
    if data is None:
        return None
    features = data.get("features")
    if not isinstance(features, list):
        return None
    colors, rows = _collect_fill_author(features)
    if not colors:
        return None
    per_feature = len(colors) >= 2
    fields: list[dict[str, Any]] = []
    if per_feature and len(features) <= _FILL_AUTHOR_FEATURE_LIMIT:
        fields = _fill_author_fields(rows)
    return {"perFeature": per_feature, "fields": fields}


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
    ...     foliplus={"annotation": {"field": "name", "collide": False}}
    ... )

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

    Keys stay short because the ``annotation`` namespace already says label; the
    ``label_`` prefix belongs to the flat surfaces (Python kwargs, CONF,
    locale). A declaration is the author's default: a later choice in the
    style panel is the user's intent and wins, and Reset shows the
    declaration through again.

    A layer may declare its own fill on the same per-layer namespace, under
    the ``fill`` key:

    >>> gdf.explore(
    ...     foliplus={"fill": {"ramp": {"field": "score", "scheme": "Reds"}}}
    ... )

    .. list-table::
       :header-rows: 1

       * - Key
         - Default
         - Meaning
       * - ``mode``
         - ``ramp`` once ``ramp.field`` is declared, otherwise ``solid``
         - fill arm: one colour (``solid``) or colour by value (``ramp``)
       * - ``ramp.field``
         - - (declaring it turns the ramp on)
         - the numeric feature property to classify
       * - ``ramp.method``
         - ``jenks``
         - classification method (``jenks`` / ``quantile`` / ``equal`` / ``heads``)
       * - ``ramp.classes``
         - ``6``
         - number of classes, 2-9
       * - ``ramp.scheme``
         - ``Viridis``
         - palette name (the style panel's own candidates)

    Precedence matches the label declaration: the user's choice in the style
    panel wins, then the declaration, then the author's per-feature paint
    (``explore``'s baked colours) and finally the built-in default. Reset
    returns to the declared ramp. An invalid declaration only warns and falls
    back; it never paints a ramp the author did not ask for.
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

            entry: dict[str, object] = {
                "name": item.layer_name,
                "id": name,
                "role": "overlay" if item.overlay else "base",
                "show": bool(item.show),
            }
            author = _fill_author(item)
            if author is not None:
                entry["fillAuthor"] = author
            data.append(entry)

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: d["role"] == "base")
        return {"data": data}
