"""Shared reader for the declared zoom range.

A layer declares it in its own ``foliplus={...}`` namespace
(``folium.GeoJson(..., foliplus={"zoom_range": {...}})``); the two declarative
controls take the range directly (``HeatmapControl(zoom_range={...})``). The
entry points differ because a control is not a folium layer, but the shape,
the validation and the verdict are the same for all three call sites: both
ends are required integers with ``min <= max``, and a malformed declaration is
reported once and then treated exactly like "not declared". The warning family
is process-wide (see :data:`_foliplus_reports`), so re-rendering a page does
not repeat a line.
"""

from __future__ import annotations

import numbers
import os
import sys
import warnings
from collections.abc import Mapping
from pathlib import Path
from types import FrameType

import folium

#: The declaration key that asks for a visibility window over map zoom levels.
ZOOM_RANGE_KEY = "zoom_range"

# Diagnostics already reported in this process, so re-rendering a page does not
# repeat the same line. Each family owns its own filter: the foliplus={...}
# declaration rejections and the refused captions (#781) do not crowd each
# other out at the cap.
_refused_captions: set[tuple[str, ...]] = set()
_foliplus_reports: set[tuple[str, ...]] = set()

_LOG_FILTER_CAP = 64

#: Directory of this package with a trailing separator, so a sibling whose name
#: merely starts with it (e.g. "foliplus-demo") cannot pass for library code.
_PACKAGE_DIR = str(Path(__file__).resolve().parent) + os.sep
#: Installed dependency tree. A foliplus= warning is raised while the control is
#: being *rendered*, so between this package and the author's cell sit the Jinja
#: template machinery, folium and branca. Pointing the warning at
#: jinja2/environment.py would be technically accurate and useless; the walk
#: skips the plumbing too, and stops at the first frame that is neither this
#: package nor an installed dependency.
_DEPENDENCY_DIR = str(Path(folium.__file__).resolve().parent.parent) + os.sep
_PLUMBING_DIRS = (_PACKAGE_DIR, _DEPENDENCY_DIR)


def _is_plumbing(filename: str) -> bool:
    """True for a frame that is machinery, not the author's code.

    Three shapes count: this package; the installed dependency tree (a render
    passes through jinja2, folium and branca); and a synthetic source name -
    Jinja compiles a template *string* to a code object whose filename is
    "<template>", and that is the frame a render-time warning is raised from.
    """
    return filename.startswith(_PLUMBING_DIRS) or filename.startswith("<")


def _caller_stacklevel() -> int:
    """Frames from warnings.warn out to the first frame that is the author's.

    A fixed stacklevel cannot work here, and that is a fact of the call path
    rather than a guess: a layer declaration is read during the Jinja render,
    which compiles the control template to a "<template>" frame and calls
    through its own interpreter frames, so between this package and the
    author's cell sit the template frame, jinja2 and folium. The depth also
    differs between call paths (a control declaration is read at construction,
    one frame lower). Walking out to the first frame that is not plumbing is
    therefore the only stable rule.
    """
    frame: FrameType | None = sys._getframe(1)  # the warning helper that called us
    level = 1
    while frame is not None:
        if not _is_plumbing(frame.f_code.co_filename):
            return level
        frame = frame.f_back
        level += 1
    return level  # pragma: no cover - only when the whole stack is library code


def _should_report(note: tuple[str, ...], store: set[tuple[str, ...]]) -> bool:
    """True when this diagnostic has not been printed in this process yet.

    ``store`` is the family's own filter (one per diagnostic family, so the
    families do not crowd each other out at the cap). The cap keeps a long
    process that renders many maps from growing the set without bound;
    clearing it wholesale is what #781 chose over an LRU.
    """
    if note in store:
        return False
    if len(store) >= _LOG_FILTER_CAP:
        store.clear()
    store.add(note)
    return True


def _warn_foliplus(note: str, message: str) -> None:
    """Report one unusable foliplus={...} declaration at the line that wrote it.

    De-duplicated through the same process-wide log-filter mechanism as the
    refused captions, but its own family store (see :func:`_should_report` and
    the ``_foliplus_reports`` / ``_refused_captions`` split): the note carries
    the owner and the defect, so one typo on three layers prints three
    attributable warnings and re-rendering the same page stays quiet. Never
    raises: a typo in the declaration namespace is a warning, not a page
    failure.
    """
    if not _should_report(("foliplus", note), _foliplus_reports):
        return
    warnings.warn(message, UserWarning, stacklevel=_caller_stacklevel())


def _zoom_level(raw: object) -> int | None:
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


def _normalise_zoom_range(
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
    the layer/control on a payload the author never saw validated.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name), so every message and de-duplication note is attributable. ``source``
    is how the author wrote it (the layer's ``foliplus['zoom_range']`` or a
    control's ``zoom_range=``), so the warning points at the entry point they
    used. Both keys are required, must be integers, and must be ordered;
    anything else warns once and is ignored.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ZOOM_RANGE_KEY!r}]"

    def _reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:zoom_range:{reason}"
        _warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if not isinstance(raw, Mapping):
        _reject(f"as {type(raw).__name__}; expected a mapping")
        return None
    # ``key=repr`` keeps a mixed-type payload (``{1: ..., "min": ...}``) from
    # raising inside ``sorted``: a malformed declaration warns, it never takes
    # the page down.
    extra = sorted((key for key in raw if key not in {"min", "max"}), key=repr)
    if extra:
        _reject(f"with unknown key(s) {extra}; expected only min and max")
        return None
    raw_lo, raw_hi = raw.get("min"), raw.get("max")
    lo, hi = _zoom_level(raw_lo), _zoom_level(raw_hi)
    if lo is None:
        _reject(f"with a non-integer min={raw_lo!r}")
        return None
    if hi is None:
        _reject(f"with a non-integer max={raw_hi!r}")
        return None
    if lo > hi:
        _reject(f"with min={lo} > max={hi}")
        return None
    return {"min": lo, "max": hi}
