"""Opacity declarations: the per-layer opacity and the icon/marker colour alpha.

Two families live here, both read by the JS panel as read-time defaults (Reset
return points), never as draw overrides:

* ``opacity`` - the whole-layer opacity (0-1, Leaflet opacity unit). A scalar
  declaration: ``foliplus={"opacity": 0.6}`` names the value the panel opacity
  slider starts at and Reset returns to. folium ``opacity=`` kwarg remains the
  author DRAW value and is read first; this declaration is the panel
  read-time default, so the two channels never fight (a layer that sets both
  draws the folium value but shows the declared one in the panel).
* ``icon.colorOpacity`` / ``marker.colorOpacity`` - the marker glyph / chassis
  alpha (0-100 integer percent, the panel unit). These ride the ``icon`` /
  ``marker`` declaration blocks, the same in-block shape #1307 fill/border
  use: a block carries the sub-dimensions one face can set.

Python validates the STRUCTURAL shape only (scalar vs block, the declared
number's range); the JS reader owns the semantic vocabulary (a preset name, a
hex) - the same split fill and border follow.
"""

from __future__ import annotations

import math
import numbers

from .key import ICON_KEY, MARKER_KEY, OPACITY_KEY
from .warning import warn_foliplus


def normalise_opacity(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> float | None:
    """Normalise one declared whole-layer opacity (0-1).

    Returns the float when the declaration is usable, else ``None``: "not
    declared" and "declared but invalid" are the same state downstream - the
    panel keeps its derived default rather than showing a value the author never
    saw validated.

    The unit is Leaflet opacity (0 = transparent, 1 = opaque), the same 0-1
    unit the panel stores and the slider drives. A bool and a
    non-finite/out-of-range value are rejected so the runtime never shows an
    unvalidated default.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name); ``source`` is how the caller wrote it, so the warning points at the
    entry point they used.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{OPACITY_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:opacity:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if isinstance(raw, bool) or not isinstance(raw, numbers.Real):
        reject(f"as {type(raw).__name__}; expected a number from 0 to 1")
        return None
    opacity = float(raw)
    if not math.isfinite(opacity) or not 0 <= opacity <= 1:
        reject(f"as {opacity}; expected a number from 0 to 1")
        return None
    return opacity


def normalise_color_opacity(
    raw: object,
    *,
    owner: str,
    subject: str | None = None,
    source: str | None = None,
) -> int | None:
    """Normalise one declared icon/marker colour alpha (0-100 integer percent).

    Returns the int when the declaration is usable, else ``None``: "not
    declared" and "declared but invalid" are the same state downstream - the
    marker keeps its derived alpha rather than painting one the author never saw
    validated.

    The unit is the panel percent (0 = transparent, 100 = opaque), a
    whole-number integer because the alpha rides an inline colour/span opacity
    and a fractional percent cannot be displayed back by the number field.
    ``numbers.Integral`` rather than ``int`` so a numpy/pandas scalar is
    accepted; ``bool`` is an ``int`` subclass but never an alpha.

    ``owner`` names the control and ``subject`` the specific subject (a layer
    name); ``source`` is how the caller wrote it.
    """
    if raw is None:
        return None

    where = f"{owner}: {subject}" if subject else owner
    declared = source or f"foliplus[{ICON_KEY!r}]"

    def reject(reason: str) -> None:
        note = f"{owner}:{subject or '-'}:color_opacity:{reason}"
        warn_foliplus(
            note,
            f"{where} declares {declared} {reason} - ignored",
        )

    if isinstance(raw, bool) or not isinstance(raw, numbers.Integral):
        reject(f"as {type(raw).__name__}; expected a whole number from 0 to 100")
        return None
    opacity = int(raw)
    if not 0 <= opacity <= 100:
        reject(f"as {opacity}; expected a whole number from 0 to 100")
        return None
    return opacity
