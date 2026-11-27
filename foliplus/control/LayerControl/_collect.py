"""Collect the layer list the panel receives in ``CONFIG["data"]``.

Split out of ``control.py``: this is the render-time walk that unions the
control's children with the parent map's, deduplicates by ``get_name()`` and
folds each layer's declarations into one entry. The module stayed over the
300-code-line criterion with this block inline (see
``script/check/module_size_check.py``); moving it leaves ``control.py`` to the
class contract — docstring, constructor and FieldSpecs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from branca.element import Element
from folium.map import Layer

from foliplus._declaration import FILTER_KEY

from ._face import declared_icon_block, declared_marker_block
from ._fill_author import fill_author, map_colormaps
from ._folder import _folder_key, warn_unclaimed_folders
from ._layer import (
    declared_border,
    declared_fill,
    declared_filter,
    declared_folder,
    declared_icon_size,
    declared_marker_color,
    declared_zoom_range,
)
from ._opacity import declared_opacity
from ._role import layer_role

if TYPE_CHECKING:
    from .control import LayerControl


def collect_layer_data(control: LayerControl) -> dict[str, object]:
    """Walk the control and the parent map, one ``data`` entry per layer.

    The union is deduplicated by ``get_name()``; the declarations contribute
    their optional facts (``fill_author`` / ``zoom_range`` / ``folder`` / filter)
    and shape warnings happen here, once per rendered control.
    """
    data: list[dict[str, object]] = []
    seen: set[str] = set()
    claimed_folders: set[tuple[str, str]] = set()
    candidates: list[Element] = [*control._children.values()]
    if (parent := control._parent) is not None:
        candidates += [*parent._children.values()]
    # The explore scales live on the map, not on the layer: read them once
    # for the whole pass, from the control's own parent chain (see
    # map_colormaps). ``claimed`` keeps one scale per layer.
    colormaps = map_colormaps(control)
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
            entry["fill_author"] = author
        zoom_range = declared_zoom_range(item, item.layer_name)
        if zoom_range is not None:
            entry["zoom_range"] = zoom_range
        folder = declared_folder(item, item.layer_name)
        if folder is not None:
            entry["folder"] = folder
            claimed_folders.add((layer_role(item), _folder_key(folder)))
        filter_decl = declared_filter(item, item.layer_name)
        if filter_decl is not None:
            entry[FILTER_KEY] = filter_decl
        # A border declaration is read by the JS panel straight off
        # layer.options.foliplus (same channel as fill/label). Python's
        # only job here is the shape validation + one-time warning: a
        # malformed border warns at collection time instead of silently
        # painting a mode the author never saw validated.
        declared_border(item, item.layer_name)
        # The fill declaration rides the same channel (JS reads it off
        # layer.options.foliplus): Python only shape-validates and warns
        # once, so a malformed solid/value declaration is reported where
        # it was written instead of painting an unvalidated face.
        declared_fill(item, item.layer_name)
        # Marker chassis colour and icon pixel size ride the same channel
        # as border: the JS panel reads them straight off
        # layer.options.foliplus (via the shared declared-key reader), so
        # Python's only job is shape validation + one-time warning at
        # collection time - a malformed declaration warns here instead of
        # silently scaling/painting a value the author never saw
        # validated. Neither emits a CONF fact; each is read per layer.
        declared_marker_color(item, item.layer_name)
        declared_icon_size(item, item.layer_name)
        # Whole-layer opacity and the icon / marker blocks ride the same
        # channel as border: the JS panel reads them straight off
        # layer.options.foliplus, so Python only shape-validates and warns once
        # at collection time. The block readers own the in-block spelling rule
        # (camel and snake both accepted, unknown sub-keys warned) in
        # foliplus._declaration.block - one normalisation point, never a
        # per-reader "did you mean" branch.
        declared_opacity(item, item.layer_name)
        declared_icon_block(item, item.layer_name)
        declared_marker_block(item, item.layer_name)
        data.append(entry)

    # A folder name shared by several layers is a grouping intent, not a
    # conflict: the JS side merges same-name declarations of the same role
    # into one authorFolderId (folder = role name, one role may
    # hold many member rows). Each declaring layer simply emits the name.

    # A central folders= declaration no layer claims never reaches the
    # panel, so its folded default silently fails: warn once per miss so
    # the author can fix the name (never raise, never drop the entry).
    warn_unclaimed_folders(control.folders, claimed_folders)

    # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
    data.sort(key=lambda d: d["role"] == "base")
    return {"data": data}
