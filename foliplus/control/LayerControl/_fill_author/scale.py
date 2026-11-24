"""The author's per-feature paint: property reads, colors and color math.

The fill-author payload starts here. explore writes ``__folium_color`` on
every feature; this module owns reading that property, sampling colors and
comparing hex spellings within branca's rounding slack. The ``FILL_AUTHOR_*``
thresholds live here too: the other fill-author modules import them from this
one home, so the payload cannot drift from the checks that gate it.
"""

from __future__ import annotations

import json
import math
import numbers
from collections.abc import Iterable
from typing import Any

from folium import GeoJson
from folium.map import Layer

FOLIUM_COLOR_PROP = "__folium_color"

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
