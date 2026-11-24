"""Marker declarations: the chassis colour and icon pixel size defaults."""

from __future__ import annotations

import numbers
from typing import Any

from .key import ICON_SIZE_KEY, MARKER_COLOR_KEY
from .paint import _HEX_COLOR_RE
from .warning import warn_foliplus


def normalise_marker_color(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> str | None:
    """Normalise one declared marker chassis preset name.

    Returns the stripped preset name, or the hex lowered to lowercase when the
    declaration is a CSS hex (#rgb / #rrggbb), else ``None``: "not declared"
    and "declared but invalid" are the same state downstream - the marker
    keeps its derived chassis colour rather than painting a name the author
    never saw validated.

    The *shape* is gated here (a non-empty string in the preset vocabulary OR
    a CSS hex). Whether a preset name is one of the runtime's chassis presets
    is the JS reader's verdict: the preset vocabulary lives in
    markerColorPreset.ts, and duplicating the 19-name closed set here would be
    a second list to keep in step with the runtime's - the same split the enum
    filter uses (shape here, vocabulary at the consumer). An unknown preset
    name therefore survives this reader and is warned once by the JS panel,
    which owns the preset table. A CSS hex shape is recognised here and
    normalised exactly as the JS reader normalises it (#rgb is expanded to
    #rrggbb and the value lowered), so the two channels carry the same
    string for one chassis colour; a malformed hex is not a preset either
    and also survives this reader, so the JS panel warns once for it - the
    hex vocabulary is the JS reader's, not this module's.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable.
    ``source`` is how the caller wrote it (the layer's
    ``foliplus['marker_color']``), so the warning points at the entry point
    they used. A non-string or blank value warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{MARKER_COLOR_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:marker_color:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, str):
        reject(f"as {type(raw).__name__}; expected a non-empty string")
        return None
    name = raw.strip()
    if not name:
        reject("as an empty or whitespace-only string; expected a non-empty string")
        return None
    # A hex shape must be a valid CSS hex (3 or 6 digits); anything else is a
    # shape defect and warns at collection time (a malformed hex is not a
    # preset the JS reader owns).
    if _HEX_COLOR_RE.match(name):
        # Expand #rgb to #rrggbb here too - the JS reader paints the expanded
        # form (normalizeHexColor), so the two channels must agree on the
        # string for one chassis colour (single source, not shape-only).
        if len(name) == 4:  # "#rgb"
            r, g, b = name[1], name[2], name[3]
            return f"#{r}{r}{g}{g}{b}{b}".lower()
        return name.lower()
    return name


# ── Marker icon pixel-size declaration ───────────────────────────────
def normalise_icon_size(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> int | None:
    """Normalise one declared marker icon pixel size.

    Returns a positive int when the declaration is usable, else ``None``:
    "not declared" and "declared but invalid" are the same state downstream -
    the marker keeps its built-in pixel size rather than scaling to a value
    the author never saw validated.

    A whole-number pixel size is required: a marker icon scales as a box, so a
    fractional pixel is not meaningful, and a zero/negative size would hide
    the marker. ``numbers.Integral`` rather than ``int`` so a numpy/pandas
    scalar from a data-driven declaration is accepted like any other integer;
    ``bool`` is an ``int`` subclass but never a size, so it is rejected too.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name); ``source`` is how the caller wrote it. A non-integer, zero or
    negative value warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ICON_SIZE_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:icon_size:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if isinstance(raw, bool) or not isinstance(raw, numbers.Integral):
        reject(f"as {type(raw).__name__}; expected a positive whole number of pixels")
        return None
    size = int(raw)
    if size <= 0:
        reject(f"as {size}; expected a positive whole number of pixels")
        return None
    return size
