"""The diagnostics channel: one warning family, reported once per process."""

from __future__ import annotations

import os
import sys
import warnings
from pathlib import Path
from types import FrameType

import folium

# ── Module constants ─────────────────────────────────────────────────────
# Diagnostics already reported in this process, so re-rendering a page does not
# repeat the same line. Each family owns its own filter: the foliplus={...}
# declaration rejections and the refused captions do not crowd each other out
# at the cap.
refused_captions: set[tuple[str, ...]] = set()
foliplus_reports: set[tuple[str, ...]] = set()

LOG_FILTER_CAP = 64

#: Directory of this package with a trailing separator, so a sibling whose name
#: merely starts with it (e.g. "foliplus-demo") cannot pass for library code.
PACKAGE_DIR = str(Path(__file__).resolve().parents[1]) + os.sep
#: Installed dependency tree. A foliplus= warning is raised while the control is
#: being *rendered*, so between this package and the caller's cell sit the Jinja
#: template machinery, folium and branca. Pointing the warning at
#: jinja2/environment.py would be technically accurate and useless; the walk
#: skips the plumbing too, and stops at the first frame that is neither this
#: package nor an installed dependency.
DEPENDENCY_DIR = str(Path(folium.__file__).resolve().parent.parent) + os.sep
PLUMBING_DIRS = (PACKAGE_DIR, DEPENDENCY_DIR)


def is_plumbing(filename: str) -> bool:
    """True for a frame that is machinery, not the caller's code.

    Three shapes count: this package; the installed dependency tree (a render
    passes through jinja2, folium and branca); and a synthetic source name -
    Jinja compiles a template *string* to a code object whose filename is
    "<template>", and that is the frame a render-time warning is raised from.
    """
    return filename.startswith(PLUMBING_DIRS) or filename.startswith("<")


def caller_stacklevel() -> int:
    """Frames from warnings.warn out to the first frame that is the caller's.

    A fixed stacklevel cannot work here, and that is a fact of the call path
    rather than a guess: a layer declaration is read during the Jinja render,
    which compiles the control template to a "<template>" frame and calls
    through its own interpreter frames, so between this package and the
    caller's cell sit the template frame, jinja2 and folium. The depth also
    differs between call paths (a control declaration is read at construction,
    one frame lower). Walking out to the first frame that is not plumbing is
    therefore the only stable rule.
    """
    frame: FrameType | None = sys._getframe(1)  # the warning helper that called us
    level = 1
    while frame is not None:
        if not is_plumbing(frame.f_code.co_filename):
            return level
        frame = frame.f_back
        level += 1
    return level  # pragma: no cover - only when the whole stack is library code


def should_report(note: tuple[str, ...], store: set[tuple[str, ...]]) -> bool:
    """True when this diagnostic has not been printed in this process yet.

    ``store`` is the family's own filter (one per diagnostic family, so the
    families do not crowd each other out at the cap). The cap keeps a long
    process that renders many maps from growing the set without bound;
    clearing it wholesale is what #781 chose over an LRU.
    """
    if note in store:
        return False
    if len(store) >= LOG_FILTER_CAP:
        store.clear()
    store.add(note)
    return True


def warn_foliplus(note: str, message: str) -> None:
    """Report one unusable foliplus={...} declaration at the line that wrote it.

    De-duplicated through the same process-wide log-filter mechanism as the
    refused captions, but its own family store (see :func:`should_report` and
    the ``foliplus_reports`` / ``refused_captions`` split): the note carries
    the owner and the defect, so one typo on three layers prints three
    attributable warnings and re-rendering the same page stays quiet. Never
    raises: a typo in the declaration namespace is a warning, not a page
    failure.
    """
    if not should_report(("foliplus", note), foliplus_reports):
        return
    warnings.warn(message, UserWarning, stacklevel=caller_stacklevel())


# ── Zoom-range declaration ───────────────────────────────────────────────


def warn_filter(message: str) -> None:
    """Report one unusable filter declaration at the line that wrote it.

    Never raises: a shape-level problem (a non-numeric bound, an inverted
    range, an empty or non-string value list) must be visible and ignored,
    not take the page down.

    The frame walk in :func:`caller_stacklevel` is shared with the zoom-range
    reader: a fixed stacklevel cannot cover both a control's ``__init__`` and a
    layer read during the Jinja render.
    """
    warnings.warn(message, UserWarning, stacklevel=caller_stacklevel())
