"""The branca scale reads: mounted colormaps, their samples and stops.

The author's scale is a branca colormap mounted on the map, not a field of the
layer. This module turns one into the facts the fill-author payload needs: the
scales reachable from the control, the color a scale paints at a value, how far
its colors agree with the layer, and the stop list of a continuous ramp.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from typing import Any, cast

from branca.colormap import LinearColormap, StepColormap

from .scale import FILL_AUTHOR_STOPS, numeric_value, same_color


def map_colormaps(node: Any) -> list[Any]:
    """The branca scales geopandas mounted on the map, from the control's chain.

    The walk starts at the control and follows ``_parent`` upwards, so a
    control attached to a FeatureGroup (not directly to the map) still reaches
    the map's scales instead of silently losing the declaration.

    ``gdf.explore(column=..., cmap=...)`` adds a colormap child per explored
    layer — a ``LinearColormap`` for a continuous column, a ``StepColormap``
    for a classified one. ``legend=False`` adds none, and a categorical column
    adds none either; both fall back to the color set alone.
    """
    colormaps: list[Any] = []
    visited: set[int] = set()
    while node is not None and id(node) not in visited:
        visited.add(id(node))
        children = getattr(node, "_children", None)
        if isinstance(children, dict):
            colormaps.extend(
                child
                for child in children.values()
                if isinstance(child, (LinearColormap, StepColormap))
            )
        node = getattr(node, "_parent", None)
    return colormaps


def colormap_sample(colormap: Any, value: object) -> str | None:
    """The scale's hex color at one value, or None when it cannot sample."""
    try:
        return str(colormap(value))[:7]
    except (TypeError, ValueError):
        return None


def column_agreement(
    colormap: Any,
    rows: list[tuple[dict[str, Any], str]],
    column: str,
) -> tuple[int, int]:
    """How many sampled features of one column the scale reproduces."""
    hits = total = 0
    for props, color in rows:
        value = numeric_value(props.get(column))
        if value is None:
            continue
        sample = colormap_sample(colormap, value)
        if sample is None:
            continue
        total += 1
        hits += same_color(sample, color)
    return hits, total


def stepped_agreement(
    colormap: Any,
    rows: list[tuple[dict[str, Any], str]],
    column: str,
) -> tuple[int, int]:
    """How many sampled features carry one of a classified scale's own blocks.

    A stepped scale paints discrete blocks, so membership is exact and needs no
    probability bar: its own layer is painted in exactly those block colors,
    even when a feature's value falls on the far side of a mapclassify bin edge
    and the scale would draw the adjacent class. (The premise is that the
    painted layer is a classified layer whose features carry one of these block
    colors; a layer not painted by the scale at all scores 0/132 and refuses.
    ) A scale the layer was not painted with normally contributes no block the
    features carry: on an evenly spread sample none of the 132 ordered pairs of
    the palettes listed at FILL_AUTHOR_AGREE was accepted. Palettes that share
    a stop are not separated — 10 of those pairs do within
    FILL_AUTHOR_RGB_SLACK, RdYlBu_09 and RdYlGn_09 share four — and a layer
    sorted by the painted value samples one shared block, so such a scale is
    accepted at 12/12. Membership is the whole test, not proof that the scale
    is the author's.
    """
    blocks = [
        hex_color
        for color in getattr(colormap, "colors", ())
        if (hex_color := palette_hex(color)) is not None
    ]
    hits = total = 0
    for props, color in rows:
        if numeric_value(props.get(column)) is None:
            continue
        total += 1
        hits += any(same_color(block, color) for block in blocks)
    return hits, total


def rgba_hex(color: object) -> str | None:
    """A branca RGBA stop (floats in 0..1) as a hex color."""
    try:
        channels = list(cast(Iterable[float], color))[:3]
    except TypeError:
        return None
    try:
        red, green, blue = (int(round(float(channel) * 255)) for channel in channels)
    except (TypeError, ValueError):
        return None
    return f"#{red:02x}{green:02x}{blue:02x}"


def palette_hex(color: object) -> str | None:
    """One palette stop as #rrggbb: a 0..1 RGBA tuple, or a hex string."""
    if isinstance(color, str):
        raw = color.strip().lower()
        if not raw.startswith("#") or len(raw) not in (4, 7, 9):
            return None
        if len(raw) == 4:
            return "#" + "".join(channel * 2 for channel in raw[1:])
        return raw[:7]
    return rgba_hex(color)


def continuous_stops(colormap: Any) -> list[str]:
    """The scale sampled evenly over its own index.

    The scale's stops are the palette itself, so formatting them directly
    keeps each hex exactly what the scale paints (verified against the scale's
    own interpolation: every index point maps to its own stop) and skips one
    interpolation per sample, which is the strip's whole cost on a 20k layer.
    A scale whose palette does not line up with its index falls back to the
    interpolation path.
    """
    try:
        points = [float(point) for point in colormap.index]
    except TypeError:
        return []
    if not points:
        return []
    if len(points) <= FILL_AUTHOR_STOPS:
        picks = list(range(len(points)))
    else:
        step = (len(points) - 1) / (FILL_AUTHOR_STOPS - 1)
        picks = [round(index * step) for index in range(FILL_AUTHOR_STOPS)]
    colors = getattr(colormap, "colors", None)
    if isinstance(colors, (list, tuple)) and len(colors) == len(points):
        stops: list[str] = []
        for at in picks:
            hex_color = palette_hex(colors[at])
            if hex_color is not None:
                stops.append(hex_color)
        return stops
    stops = []
    for at in picks:
        sample = colormap_sample(colormap, points[at])
        if sample is not None:
            stops.append(sample)
    return stops


def provable_equal_interval(index: list[float]) -> bool:
    """Whether a stepped scale's breaks are provably equally spaced.

    geopandas.explore never keeps the ``scheme`` argument it passed to
    ``mapclassify.classify`` on the mounted Colormap or the GeoJson layer
    (measured: the colormap ``__dict__`` holds only vmin/vmax/caption/index/
    colors -- no scheme). So the panel cannot read the author's method string.
    The one method that is *mathematically provable* from the shipped breaks
    is ``equal_interval``: every class spans the same width, so the adjacent
    break gaps are identical. quantiles/fisherjenks/head_tail_breaks have no
    closed form from the edges alone, so they are deliberately never guessed --
    the panel states a dash instead. This is a *consistency* proof, not a
    claim about the author's scheme: a uniform distribution under quantiles,
    or an author who hand-set equal-width breaks, would also produce equal
    gaps, so the proof states "provably equal-interval spacing" rather than
    naming the scheme argument. Future geopandas that does expose the
    scheme can extend this without changing the honest None branch.
    """
    if len(index) < 3:
        # Need at least two intervals to compare; a single class has no
        # provable method either.
        return False
    gaps = [b - a for a, b in zip(index, index[1:])]
    if any(gap <= 0 for gap in gaps):
        # Degenerate or descending edges are not a classification; never claim
        # a method for a scale that cannot classify.
        return False
    first = gaps[0]
    # float division may leave a rounding hair (a 100-wide range over three
    # classes yields 33.333...), so compare with a relative tolerance rather
    # than exact equality. The tolerance only absorbs float noise (~ulp); it
    # never absorbs a deliberate re-rounding, so a scheme that quantised its
    # edges to whole numbers is not misread as equal-interval.
    return all(math.isclose(gap, first, rel_tol=1e-9, abs_tol=1e-9) for gap in gaps[1:])
