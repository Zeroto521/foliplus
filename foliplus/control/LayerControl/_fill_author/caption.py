"""The author's caption check: pair one scale with the layer it painted.

A scale whose caption names a numeric property is a candidate; the sampled
colors are the veto. This module holds that pairing (and the one-time warning
for a refused caption) so the payload only receives a scale it can trust.
"""

from __future__ import annotations

import logging
from typing import Any

from branca.colormap import StepColormap

from foliplus._declaration import refused_captions, should_report

from .colormap import column_agreement, stepped_agreement
from .scale import (
    FILL_AUTHOR_AGREE,
    author_rows,
    numeric_value,
)

log = logging.getLogger(__package__)


def caption_names_a_value(rows: list[tuple[dict[str, Any], str]], caption: str) -> bool:
    """Whether any sampled feature carries the caption as a numeric value.

    The check runs over the whole sample, not its first row: a layer painted
    with ``missing_kwds`` colors its missing features too, so a feature whose
    value is NaN can open the sample. One missing value must not talk the scale
    out of the whole layer — the color check skips that row anyway.
    """
    for props, _ in rows:
        if caption in props and numeric_value(props[caption]) is not None:
            return True
    return False


def pair_scale(
    colormaps: list[Any],
    features: list[Any],
    claimed: set[int],
) -> tuple[Any, str] | None:
    """Pair one scale with its layer, and only on the author's own caption.

    The caption is the column geopandas drew the scale for. When it is a
    numeric property of the layer, that column is the answer and no other
    column is ever considered; the color check then vetoes the pairing when the
    features are not painted by that scale (a layer can share a property name
    with a foreign scale), and it is the only thing standing between a caption
    and a wrong field name.

    Two boundaries are deliberate and documented rather than guessed at:

    * The caption is a declaration, the colors are the veto, and the check runs
      per layer in render order. Columns with equivalent colors — an affine
      pair such as area / area_ha, the docstring example — cannot be told
      apart by any color check, so the first layer whose caption matches keeps
      the scale and the second one ships its colors without a field. Guessing
      one of two indistinguishable columns would just as often be wrong, at the
      cost of the column that is right.
    * A scale whose caption belongs to another layer is not claimed at all: the
      panel then shows the colors the features carry, with no scale, no column
      and no field name to invent. The absence is deliberate — a correlated
      column (area / area_ha / area_km2, or a near-duplicate within a couple of
      percent) reproduces the same coarse color bands, so 10 random datasets
      with a caption that named no column picked the wrong column 10 times out
      of 10 at 2-6 classes. The price is stated too: a stepped layer that loses
      this way keeps its colors but drops the author's levels and breaks.
    """
    if not colormaps or not features:
        return None
    rows = author_rows(features)
    if not rows:
        return None
    for colormap in colormaps:
        if id(colormap) in claimed:
            continue
        caption = getattr(colormap, "caption", None)
        if not isinstance(caption, str) or not caption_names_a_value(rows, caption):
            continue
        if isinstance(colormap, StepColormap):
            # Discrete blocks are exactly comparable, so the class colors are
            # the test: a feature painted by this scale always carries one of
            # its k blocks, whichever side of a bin edge its value sits on.
            hits, total = stepped_agreement(colormap, rows, caption)
            agrees = total == 0 or hits == total
            criterion = "carry one of its blocks"
        else:
            hits, total = column_agreement(colormap, rows, caption)
            agrees = not total or hits / total >= FILL_AUTHOR_AGREE
            criterion = "match its colors"
        if not agrees:
            warn_refused_caption(caption, hits, total, criterion=criterion)
            continue
        claimed.add(id(colormap))
        return colormap, caption
    return None


def warn_refused_caption(
    caption: str, hits: int, total: int, *, criterion: str
) -> None:
    """Report a refused caption once per (caption, criterion, agreement) pair.

    ``criterion`` names the test that failed, so the message says which one: the
    stepped variant tests exact block membership, the continuous variant tests the
    color-match ratio against FILL_AUTHOR_AGREE.
    """
    if not should_report(
        ("caption", caption, criterion, str(hits), str(total)), refused_captions
    ):
        return
    log.warning(
        "LayerControl: the scale caption %r names a column, but only %d/%d "
        "sampled features %s; not claiming it",
        caption,
        hits,
        total,
        criterion,
    )
