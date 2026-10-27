from __future__ import annotations

import json
import numbers
from typing import Annotated, Any

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


def _fill_author_fields(
    rows: list[tuple[dict[str, Any], str]],
) -> list[dict[str, Any]]:
    """Candidate columns for the value-to-colour mapping, computed once.

    A column qualifies when every coloured feature carries it with a primitive
    value and each of its values maps to exactly one colour. The mapping keeps
    the most frequent _FILL_AUTHOR_FIELD_LIMIT values; the rest are counted in
    other and flagged by truncated.
    """
    first_props = rows[0][0]
    candidates = [
        name
        for name, value in first_props.items()
        if not name.startswith("_") and isinstance(value, (str, int, float))
    ]
    fields: list[dict[str, Any]] = []
    for name in candidates:
        mapping: dict[str, str] = {}
        numeric = True
        ok = True
        for props, color in rows:
            value = props.get(name)
            if isinstance(value, bool) or not isinstance(value, (str, int, float)):
                ok = False
                break
            if not isinstance(value, numbers.Real):
                numeric = False
            key = str(value)
            seen = mapping.get(key)
            if seen is not None and seen != color:
                ok = False
                break
            mapping[key] = color
        if not ok or len(mapping) < 2:
            continue
        counts: dict[str, int] = {}
        for props, _color in rows:
            key = str(props[name])
            counts[key] = counts.get(key, 0) + 1
        ordered = sorted(counts.items(), key=lambda entry: (-entry[1], entry[0]))
        kept = ordered[:_FILL_AUTHOR_FIELD_LIMIT]
        fields.append(
            {
                "name": name,
                "kind": "numeric" if numeric else "categorical",
                "mapping": {key: mapping[key] for key, _count in kept},
                "other": len(ordered) - len(kept),
                "truncated": len(ordered) > len(kept),
            }
        )
    return fields


def _fill_author(item: Layer) -> dict[str, Any] | None:
    """Per-feature fill metadata for a folium GeoJson, from its features.

    Reads properties.__folium_color, which geopandas.explore writes for every
    feature; a style_function layer has no such property and returns None, so
    JavaScript keeps the normal single-colour arms for it. One pass over the
    features; above _FILL_AUTHOR_FEATURE_LIMIT features only the colour set is
    reported, so the payload stays bounded.
    """
    if not isinstance(item, GeoJson):
        return None
    data = item.data
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return None
    if not isinstance(data, dict):
        return None
    features = data.get("features")
    if not isinstance(features, list):
        return None
    colors: set[str] = set()
    rows: list[tuple[dict[str, Any], str]] = []
    for feature in features:
        props = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            continue
        color = _fill_author_color(props)
        if color is None:
            continue
        colors.add(color)
        rows.append((props, color))
    if not colors:
        return None
    meta: dict[str, Any] = {"perFeature": len(colors) >= 2, "fields": []}
    if len(features) <= _FILL_AUTHOR_FEATURE_LIMIT and meta["perFeature"]:
        meta["fields"] = _fill_author_fields(rows)
    return meta


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
