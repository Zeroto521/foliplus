from __future__ import annotations

import json
import logging
import math
import numbers
from collections.abc import Iterable
from typing import Any, cast

from branca.colormap import LinearColormap, StepColormap
from folium import GeoJson
from folium.map import Layer

from foliplus._declaration import refused_captions, should_report

FOLIUM_COLOR_PROP = "__folium_color"

log = logging.getLogger(__package__)

# The panel only draws the strip: 64 samples are enough for a continuous
# scale (a LinearColormap carries 256 stops) and keep CONF small.
FILL_AUTHOR_STOPS = 64
# Features sampled for the checks that validate a caption. One sample feeds
# both rules: the stepped test requires every row to carry one of the scale's
# blocks, so more rows only make that veto stricter, while the continuous test
# reads its bar off the same rows (8 of 12 must match, so four features the
# scale does not paint are still tolerated). 12 keeps both checks at a fraction
# of a millisecond.
FILL_AUTHOR_SAMPLE = 12
# Features scanned for the distinct-color strip. The strip is a preview and the
# panel only needs "at least two colors" plus 64 samples, so a low-cardinality
# layer must not cost a full walk: past this budget the record is capped.
FILL_AUTHOR_SCAN_LIMIT = 4_096
# Per-channel slack when comparing a colormap color with __folium_color:
# branca's hex and the leaf's property round differently (measured max 2/255
# over 40 features of a plasma and a viridis scale).
FILL_AUTHOR_RGB_SLACK = 2
# Pairing threshold, continuous variant only: the stepped variant tests exact block
# membership instead, so only column_agreement reads this. A scale mounted on
# its own layer reproduces every sampled hex (measured 12/12, and 200/200 over
# 200 random values). On an evenly spread sample no foreign palette comes near
# the bar: 0 of the 132 ordered pairs of RdYlBu_09, RdYlGn_09, Spectral_11,
# PiYG_09, BrBG_09, viridis, plasma, inferno, magma, Blues_09, Reds_09 and
# YlOrRd_09 reached it, the best being RdYlBu_09 vs RdYlGn_09 at 5/12. Two
# things it is not — not arithmetic slack, since FILL_AUTHOR_RGB_SLACK covers
# the rounding (values rounded to whole numbers still match 12/12), and not
# proof: palettes sharing stops are not separated. Four of the 132 ordered
# pairs are accepted at 12/12 that way — RdYlBu_09/RdYlGn_09 in both
# directions (they share four stops) and inferno/magma in both directions —
# so a layer sorted by the painted value samples that shared low end and
# agrees 12/12, and this bar accepts the foreign scale. What it does buy is a
# layer the scale paints only mostly: four features hand-set still agree
# 8/12 = 0.67, five drop it to 7/12 = 0.58.
FILL_AUTHOR_AGREE = 0.6

# Distinct-color count above which a per-feature layer with no pair-able scale
# is read as a continuous ramp. Matches CLASS_COUNT.MAX in
# foliplus/js/core/classify.ts (9): the panel offers at most 9 classes, so a
# layer painting more distinct colors than any classification the user could
# have chosen is more likely a continuous colormap than a small-step scheme.
# A legend=False explore layer (which mounts no colormap at all) cannot be
# told apart from a real continuous one, so this is an accepted approximation
# (10+ class bands read as Equal Interval, <= 9 stays a dash). Kept a literal
# because Python cannot import the TS constant; the comment is the cross-stack
# pointer.
FILL_AUTHOR_CONTINUOUS_THRESHOLD = 9


def fill_author_color(props: dict[str, Any]) -> str | None:
    """The feature's declarative color, when explore wrote one."""
    color = props.get(FOLIUM_COLOR_PROP)
    return color if isinstance(color, str) else None


def geojson_data(item: Layer) -> dict[str, Any] | None:
    """The layer's GeoJson data as a mapping, or None when it is not one.

    folium accepts a mapping or a JSON string for the data; a broken string, a
    list of features or any other shape is not something this control describes,
    so it yields no author-fill metadata instead of failing the render.
    """
    if not isinstance(item, GeoJson):
        return None
    data = item.data
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except ValueError:
            return None
    return data if isinstance(data, dict) else None


def feature_properties(feature: object) -> dict[str, Any] | None:
    """A feature's properties mapping, or None for a malformed feature."""
    props = feature.get("properties") if isinstance(feature, dict) else None
    return props if isinstance(props, dict) else None


def author_colors(features: list[Any]) -> tuple[list[str], bool]:
    """Distinct declared colors in first-seen order, within a bounded scan.

    Only features that carry the property contribute, so a partially colored
    layer still reports the colors it has. The panel needs "at least two
    colors" plus a strip, so the scan stops as soon as a color beyond the cap
    shows up and it never walks more than FILL_AUTHOR_SCAN_LIMIT features: a
    low-cardinality 20,000-feature layer would otherwise pay a full walk only to
    learn that it has four colors. The sample is strided across the whole list
    rather than taken from its head, because a layer sorted by the painted
    value would otherwise show only its first class and read as a single-color
    layer. The flag says the strip cap was hit, which the caption shows as
    "N+".
    """
    seen: dict[str, None] = {}
    total = len(features)
    if total > FILL_AUTHOR_SCAN_LIMIT:
        indices: Iterable[int] = (
            index * total // FILL_AUTHOR_SCAN_LIMIT
            for index in range(FILL_AUTHOR_SCAN_LIMIT)
        )
    else:
        indices = range(total)
    for index in indices:
        props = feature_properties(features[index])
        if props is None:
            continue
        color = fill_author_color(props)
        if color is None or color in seen:
            continue
        seen[color] = None
        if len(seen) > FILL_AUTHOR_STOPS:
            return list(seen)[:FILL_AUTHOR_STOPS], True
    return list(seen), False


def author_rows(features: list[Any]) -> list[tuple[dict[str, Any], str]]:
    """A bounded sample of (properties, color) rows for the color checks."""
    rows: list[tuple[dict[str, Any], str]] = []
    for feature in features:
        props = feature_properties(feature)
        if props is None:
            continue
        color = fill_author_color(props)
        if color is None:
            continue
        rows.append((props, color))
        if len(rows) >= FILL_AUTHOR_SAMPLE:
            break
    return rows


def numeric_value(value: object) -> float | None:
    """A feature property usable as a scale input, or None.

    ``numbers.Integral`` / ``numbers.Real`` rather than ``int`` / ``float``:
    GeoJson data assembled from a GeoDataFrame can carry numpy scalars, and
    ``np.int64`` registers as ``numbers.Integral`` without being ``int``. NaN is
    a missing value, not a scale input, and ``bool`` is excluded explicitly —
    branca would accept it, but a boolean column has no scale to read.
    """
    if isinstance(value, bool):
        return None
    if isinstance(value, numbers.Integral):
        return float(value)
    if isinstance(value, numbers.Real):
        return None if math.isnan(value) else float(value)
    return None


def rgb(color: str) -> tuple[int, int, int] | None:
    """``#rgb`` / ``#rrggbb`` (any case, alpha ignored) as three channels."""
    raw = color.strip().lower()
    if not raw.startswith("#"):
        return None
    body = raw[1:]
    if len(body) == 3:
        body = "".join(channel * 2 for channel in body)
    if len(body) < 6:
        return None
    try:
        red, green, blue = (int(body[at : at + 2], 16) for at in (0, 2, 4))
    except ValueError:
        return None
    return red, green, blue


def same_color(left: str, right: str) -> bool:
    """Whether two hex colors agree within the rounding slack."""
    left_rgb = rgb(left)
    right_rgb = rgb(right)
    if left_rgb is None or right_rgb is None:
        return False
    return all(abs(a - b) <= FILL_AUTHOR_RGB_SLACK for a, b in zip(left_rgb, right_rgb))


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


def scale_payload(
    colormap: Any, column: str | None
) -> tuple[dict[str, Any], list[str]]:
    """The scale record the panel reads, plus the strip it draws.

    A continuous scale ships 64 sampled colors; a classified one ships the
    author's own blocks, because those are what the author's map shows.

    The record also states the classification *method* the panel can prove
    (see :func:`provable_equal_interval`): ``"equal"`` for a stepped scale
    whose breaks are equally spaced, ``None`` otherwise -- never a guess, so
    the JS panel shows "Equal Interval" only on that proof. A continuous
    scale is an equally spaced LinearColormap sample and carries ``None``
    here; the panel's "Equal Interval" for it is the honest statement that a
    LinearColormap *is* an interval ramp, not a claim about the author's
    ``scheme`` argument (which explore does not retain).
    """
    stepped = isinstance(colormap, StepColormap)
    if stepped:
        stops = [
            hex_color
            for color in colormap.colors
            if (hex_color := rgba_hex(color)) is not None
        ]
    else:
        stops = continuous_stops(colormap)
    scale: dict[str, Any] = {
        "kind": "stepped" if stepped else "continuous",
        "vmin": float(colormap.vmin),
        "vmax": float(colormap.vmax),
    }
    if column is not None:
        # A column is named only on evidence: a scale is shipped only after its
        # caption named a numeric property of the layer and the sampled colors
        # agreed with it. The None branch exists for a hand-built record (tests)
        # and must not invent a name.
        scale["column"] = column
    if stepped:
        scale["levels"] = len(colormap.colors)
        # The author's real class edges: the panel states the classification
        # instead of re-deriving one. np.float64 is not JSON-serializable.
        scale["breaks"] = [float(edge) for edge in colormap.index]
        scale["method"] = (
            "equal"
            if provable_equal_interval([float(edge) for edge in colormap.index])
            else None
        )
    else:
        scale["method"] = None
    return scale, stops[:FILL_AUTHOR_STOPS]


def fill_author(
    item: Layer,
    colormaps: list[Any],
    claimed: set[int],
) -> dict[str, Any] | None:
    """Per-feature fill metadata for a folium GeoJson, from its own record.

    Reads properties.__folium_color, which geopandas.explore writes for every
    feature; a style_function layer has no such property and returns None, so
    JavaScript keeps the normal single-color variants for it. When the author also
    declared a scale (a branca colormap on the map), it is shipped as
    ``scale`` only when its caption names one of the layer's numeric properties
    and the sampled colors confirm it; otherwise the record still names how
    many distinct colors the layer paints and samples them for the strip. The
    caption is the declaration and the colors are the veto, so the column is
    the author's string and never a guess.
    """
    data = geojson_data(item)
    if data is None:
        return None
    features = data.get("features")
    if not isinstance(features, list):
        return None
    colors, capped = author_colors(features)
    if not colors:
        return None
    per_feature = len(colors) >= 2
    payload: dict[str, Any] = {
        "perFeature": per_feature,
        "distinct": len(colors),
        "stops": colors,
    }
    if capped:
        payload["capped"] = True
    if not per_feature:
        return payload
    paired = pair_scale(colormaps, features, claimed)
    if paired is None:
        # No colormap paired: a legend=False explore layer mounts none, so no
        # scale can be proven and the record ships without one. A per-feature
        # layer painting more distinct colors than any classification the panel
        # offers (a 10+ color ramp, or a scan that capped at FILL_AUTHOR_STOPS)
        # is almost certainly a continuous ramp the author did not label — the
        # panel reads a bare {"kind": "continuous"} as Equal Interval, the
        # honest statement that a LinearColormap is an interval ramp, not a
        # claim about the author's scheme. stops stay the sampled strip in
        # feature-discovery order, so the record marks it "ordered": False:
        # only a paired scale's stops are domain order, and the bar must sort
        # a discovery-order strip (by lightness) instead of trusting it.
        # column / vmin / vmax / method are deliberately NOT written (a guess
        # at the drive column and extent would be worse than none). A
        # low-cardinality layer (<= FILL_AUTHOR_CONTINUOUS_THRESHOLD distinct
        # colors) keeps no scale: it may be a small-step classification the
        # panel can still describe from its own colors, and reading it as
        # continuous would be the approximation this threshold exists to avoid.
        if per_feature and (capped or len(colors) > FILL_AUTHOR_CONTINUOUS_THRESHOLD):
            payload["scale"] = {"kind": "continuous", "ordered": False}
        return payload
    colormap, column = paired
    scale, stops = scale_payload(colormap, column)
    if stops:
        payload["scale"] = scale
        payload["stops"] = stops
    return payload
