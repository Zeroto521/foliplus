"""Zoom-range declarations: the visibility window over map zoom levels."""

from __future__ import annotations

import numbers
from collections.abc import Mapping
from typing import Any

from .key import ZOOM_RANGE_KEY
from .warning import caller_stacklevel, warn_foliplus


def zoom_level(raw: object) -> int | None:
    """One declared zoom end as an int, or None when it is not an integer.

    ``numbers.Integral`` rather than ``int`` so a numpy/pandas scalar from a
    data-driven declaration is accepted like any other integer; the result is
    narrowed to a plain ``int`` so the caller's comparison and the emitted dict
    stay in int territory (and JSON-serialisable). ``bool`` is an ``int``
    subclass but never a zoom level, so it is rejected too. Returning the
    narrowed value keeps the caller from re-checking after the loop.
    """
    if isinstance(raw, bool) or not isinstance(raw, numbers.Integral):
        return None
    return int(raw)


def normalise_zoom_range(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> dict[str, int] | None:
    """Normalise one declared ``{"min": ..., "max": ...}`` zoom range.

    Returns ``{"min": int, "max": int}`` when the declaration is usable, else
    ``None``: "not declared" and "declared but invalid" are the same state
    downstream - the visibility policy stays unconstrained rather than hiding
    the layer/control on a payload the caller never saw validated.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable. ``source``
    is how the caller wrote it (the layer's ``foliplus['zoom_range']`` or a
    control's ``zoom_range=``), so the warning points at the entry point they
    used. Both keys are required, must be integers, and must be ordered;
    anything else warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ZOOM_RANGE_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:zoom_range:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        reject(f"as {type(raw).__name__}; expected a mapping")
        return None
    # ``key=repr`` keeps a mixed-type payload (``{1: ..., "min": ...}``) from
    # raising inside ``sorted``: a malformed declaration warns, it never takes
    # the page down.
    extra = sorted((key for key in raw if key not in {"min", "max"}), key=repr)
    if extra:
        reject(f"with unknown key(s) {extra}; expected only min and max")
        return None
    raw_lo, raw_hi = raw.get("min"), raw.get("max")
    lo, hi = zoom_level(raw_lo), zoom_level(raw_hi)
    if lo is None:
        reject(f"with a non-integer min={raw_lo!r}")
        return None
    if hi is None:
        reject(f"with a non-integer max={raw_hi!r}")
        return None
    if lo > hi:
        reject(f"with min={lo} > max={hi}")
        return None
    return {"min": lo, "max": hi}
