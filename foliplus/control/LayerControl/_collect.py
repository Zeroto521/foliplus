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
from folium.map import FeatureGroup, Layer

from foliplus._declaration import FILTER_KEY, LABEL_KEY, warn_foliplus

from ._face import declared_icon, declared_marker
from ._fill_author import fill_author, map_colormaps
from ._folder import _folder_key, warn_unclaimed_folders
from ._layer import (
    declared_border,
    declared_fill,
    declared_filter,
    declared_folder,
    declared_icon_size,
    declared_label,
    declared_marker_color,
    declared_zoom_range,
)
from ._opacity import declared_opacity
from ._role import layer_role

if TYPE_CHECKING:
    from .control import LayerControl


def _warn_nested_folder(item: Layer, folder: str, reason: str) -> None:
    """Ignore a folder declaration that would nest folders (owner ruling).

    Folders are root-only. A container row inside a folder is "folder 套
    group"; a layer that already sits inside a container would be "group 套
    folder" (and a folder claimed by either would allow "folder 套 folder").
    The declaration is dropped, not moved, and the report is once per
    layer+declaration through the shared foliplus warning filter.

    TODO(#1402): the JS read side (declaredFolder.ts / controller.ts placement)
    still accepts the same declarations; mirror this root-only rule there once
    #1402 lands.
    """
    warn_foliplus(
        f"LayerControl:folder-nested:{item.get_name()}:{reason}:{folder}",
        f"LayerControl: layer {item.layer_name!r} is {reason}; "
        f"foliplus={{'folder': {folder!r}}} is ignored (folders are root-only)",
    )


def collect_layer_data(control: LayerControl) -> dict[str, object]:
    """Walk the control and the parent map, one ``data`` entry per layer.

    The union is deduplicated by ``get_name()``; the declarations contribute
    their optional facts (``fill_author`` / ``zoom_range`` / ``folder`` /
    ``filter`` / ``label``)
    and shape warnings happen here, once per rendered control.
    """
    data: list[dict[str, object]] = []
    seen: set[str] = set()
    claimed_folders: set[tuple[str, str]] = set()
    candidates: list[Element] = [*control._children.values()]
    if (parent := control._parent) is not None:
        candidates += [*parent._children.values()]
    # Folders are root-only (owner ruling): a container cannot live inside a
    # folder and a layer inside a container cannot claim one, so the two sets
    # below are what a folder declaration is checked against. The data model
    # still renders author-built container nesting read-only; only the
    # declaration channel is restricted.
    # A container is a FeatureGroup (including an empty one, which still renders
    # as a container row; folium >= 0.20 ships only this group class) or any
    # Layer holding Layer children. The child filter matters: folium attaches a
    # non-Layer JavaScript element to every rendered GeoJson
    # (`geo_json_<id>_add`), so a truthy `_children` alone would turn each
    # rendered data layer into a false container.
    containers = {
        candidate
        for candidate in candidates
        if isinstance(candidate, Layer)
        and (
            isinstance(candidate, FeatureGroup)
            or any(isinstance(child, Layer) for child in candidate._children.values())
        )
    }
    nested = {
        child
        for container in containers
        for child in container._children.values()
        if isinstance(child, Layer)
    }
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
            if item in containers:
                _warn_nested_folder(item, folder, "a container layer")
            elif item in nested:
                _warn_nested_folder(item, folder, "a layer inside a container")
            else:
                entry["folder"] = folder
                claimed_folders.add((layer_role(item), _folder_key(folder)))
        filter_decl = declared_filter(item, item.layer_name)
        if filter_decl is not None:
            entry[FILTER_KEY] = filter_decl
        # The label block is the one declaration the JavaScript panel does not
        # re-read off layer.options.foliplus: the normalised record is the
        # single channel (CONF data[].label), so a key the normaliser rejected
        # cannot reach the browser as an unvalidated label default.
        label_decl = declared_label(item, item.layer_name)
        if label_decl is not None:
            entry[LABEL_KEY] = label_decl
        # A border declaration is read by the JS panel straight off
        # layer.options.foliplus (same channel as fill). Python's
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
        # Whole-layer opacity and the icon / marker face declarations ride the
        # same channel as border: the JS panel reads them straight off
        # layer.options.foliplus, so Python only shape-validates and warns once
        # at collection time. The face readers own the in-face spelling rule
        # (camel and snake both accepted, unknown sub-keys warned) in
        # foliplus._declaration.face - one normalisation point, never a
        # per-reader "did you mean" branch.
        declared_opacity(item, item.layer_name)
        declared_icon(item, item.layer_name)
        declared_marker(item, item.layer_name)
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
