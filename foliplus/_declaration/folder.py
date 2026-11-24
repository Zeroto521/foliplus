"""Folder declarations: the per-layer folder name the panel groups on."""

from __future__ import annotations

import re
import unicodedata

from .key import FOLDER_KEY, FOLDER_NAME_MAX
from .warning import warn_foliplus


def normalise_folder(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> str | None:
    """Normalise one declared layer folder name.

    Returns the stripped name when the declaration is a non-empty string, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the layer stays at the section root rather than disappearing
    into a folder the caller never saw validated.

    ``owner`` names the layer and ``subject`` the specific subject, so every
    message and de-duplication note is attributable. ``source`` is how the
    caller wrote it (the layer's ``foliplus['folder']``), so the warning
    points at the entry point they used. A non-string, blank or over-long
    value warns once and is ignored. This reader only reads, normalises and
    caps the name; role
    matching, the stable caller-folder id and the folder registry live with
    the grouping work, not here.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{FOLDER_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:folder:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, str):
        reject(f"as {type(raw).__name__}; expected a non-empty string")
        return None
    name = re.sub(r"\s+", " ", unicodedata.normalize("NFC", raw.strip()))
    if not name:
        reject("as an empty or whitespace-only string; expected a non-empty string")
        return None
    # The cap is measured on the normalised name: the same strip/fold that
    # keeps a padded name from looking long is what the panel will show, so a
    # name the author intends is not rejected by whitespace they never see.
    if len(name) > FOLDER_NAME_MAX:
        reject(
            f"at {len(name)} code points; expected at most {FOLDER_NAME_MAX}",
        )
        return None
    return name


# ── Marker chassis-colour declaration ────────────────────────────────
