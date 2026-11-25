# foliplus/control/LayerControl/_folder — the central folder-defaults declaration.
#
# The author passes folders={"overlay": [{"name": ..., "folded": ...}], "base": [...]}
# to LayerControl. This module is the single place that normalises that payload
# into the CONF contract the JS side reads: author-default folded state per
# folder, keyed by role. One module, one vocabulary — the JS reader
# (control/LayerControl) mirrors the shape, and the key computation below is
# kept in step with JS normalizeFolderName so the two cannot drift about which
# declarations are "the same folder".
#
# Membership is NOT declared here. A layer joins a folder through its own
# foliplus={"folder": ...} declaration (foliplus/_declaration/folder.py); this
# payload only carries folder metadata — display name and default folded state
# — so a name may be declared with no members yet (it then has no row to apply
# to and the declaration warns once), and a folder layers claim may be absent
# from it (it then starts expanded).
from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping

from foliplus._declaration import normalise_folder, warn_foliplus

from ._role import LAYER_ROLES

#: The entry keys v1 understands. Anything else rejects the whole entry (warn
#: once) — a future key is its own card, never silently dropped.
FOLDER_DEFAULT_KEYS = ("name", "folded")


#: The folder-default identity key. Mirrors the JS reader's normalizeFolderName
#: (foliplus/js/core/layer/folderLayout.ts): NFC → whitespace fold → trim →
#: casefold. Python emits the *display* name (first-seen, trimmed) while JS
#: keys on the folded form, so the two must agree on what counts as the same
#: folder. `.lower()` (not `.casefold()`) to match JS `toLowerCase()` — the
#: JS reader deliberately avoids full case folding, and a mismatch here would
#: split "Straße"/"STRASSE" between the two sides.
def _folder_key(name: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", name.strip())).lower()


def normalise_folders(
    raw: object,
    *,
    owner: str = "LayerControl",
    source: str = "folders",
) -> dict[str, list[dict[str, object]]] | None:
    """Normalise the central folder-defaults config.

    Returns ``{"overlay": [...], "base": [...]}`` (both keys always present)
    when *raw* is a usable mapping — possibly with empty lists after per-entry
    rejection. Returns ``None`` when *raw* is ``None`` or not a mapping at all:
    "not declared" and "declared but unusable" are the same state downstream,
    every folder stays on its built-in default (expanded) rather than folding
    on a payload the author never saw validated.

    v1 understands one entry shape: ``{"name": <str>, "folded": <bool>}`` with
    only ``name`` required. An unknown key rejects the whole entry (warn once).
    A non-mapping *raw*, an unknown section, a non-string/blank/over-long name,
    or a non-bool ``folded`` all warn once and are ignored per-item; a non-bool
    ``folded`` is treated as expanded (``False``). Same-name (NFC → ws fold →
    trim → lower) declarations merge within a section: the display name keeps
    the first spelling seen, ``folded`` is last-wins.
    """
    if raw is None:
        return None

    def reject(section: str, reason: str) -> None:
        note = f"{owner}:folders:{section}:{reason}"
        warn_foliplus(
            note,
            f"{owner} declares {source}[{section!r}] {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject("-", f"as {type(raw).__name__}; expected a mapping of sections")
        return None

    out: dict[str, list[dict[str, object]]] = {}
    for section in LAYER_ROLES:
        entries = raw.get(section)
        if entries is None:
            out[section] = []
            continue
        if not isinstance(entries, (list, tuple)) or isinstance(entries, (str, bytes)):
            reject(section, f"as {type(entries).__name__}; expected a list")
            out[section] = []
            continue
        merged: dict[str, dict[str, object]] = {}
        for idx, item in enumerate(entries):
            if not isinstance(item, Mapping):
                reject(
                    section,
                    f"entry {idx} as {type(item).__name__}; expected a mapping",
                )
                continue
            extra = sorted(
                (key for key in item if key not in FOLDER_DEFAULT_KEYS),
                key=repr,
            )
            if extra:
                reject(
                    section,
                    f"entry {idx} with unknown key(s) {extra}; "
                    "expected only name and folded",
                )
                continue
            name = normalise_folder(
                item.get("name"),
                owner=owner,
                subject=f"folders[{section}][{idx}]",
                source=source,
            )
            if name is None:
                # normalise_folder already warned (non-string/blank/over-long).
                continue
            raw_folded = item.get("folded", False)
            if isinstance(raw_folded, bool):
                folded = raw_folded
            else:
                reject(
                    section,
                    f"entry {idx} with folded={raw_folded!r}; "
                    "expected a bool (treated as expanded)",
                )
                folded = False
            key = _folder_key(name)
            if key in merged:
                # Same-name merge: first display name wins, folded is last-wins.
                merged[key]["folded"] = folded
            else:
                merged[key] = {"name": name, "folded": folded}
        out[section] = list(merged.values())
    return out


def warn_unclaimed_folders(
    folders: dict[str, list[dict[str, object]]] | None,
    claimed: set[tuple[str, str]],
    *,
    owner: str = "LayerControl",
    source: str = "folders",
) -> None:
    """Warn once per centrally declared folder no layer claims.

    A ``folders=[...]`` entry whose name no layer declares via
    ``foliplus={"folder": ...}`` never appears on the panel, so its author
    ``folded`` default points at a key that does not exist - the default fold
    fails silently. Report the miss once (the same name/role pair is
    deduplicated through :func:`warn_foliplus`) so a typo is attributable;
    never raise, and leave the declaration in the payload so the panel keeps
    showing the (empty) folder row rather than dropping the author's intent.

    Args:
        folders: The normalised central declaration, or ``None`` when not
            declared (nothing to check).
        claimed: The ``(role, folder_key)`` pairs the collected layers
            actually declare, keyed the same way :func:`_folder_key` keys the
            central names, so the comparison cannot drift about what counts
            as "the same folder".
        owner: The control name for the warning note.
        source: How the caller wrote the declaration (the ``folders=`` kwarg).
    """
    if not folders:
        return
    for section, entries in folders.items():
        for entry in entries:
            name = entry.get("name")
            if not isinstance(name, str) or (section, _folder_key(name)) in claimed:
                continue
            warn_foliplus(
                f"{owner}:{source}:{section}:unclaimed:{_folder_key(name)}",
                f"{owner} declares {source}[{section!r}] folder {name!r} but no "
                "layer declares a matching folder= - the folder never appears "
                "on the panel; check the name for a typo",
            )
