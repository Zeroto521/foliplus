"""The fill-author payload: the record the panel reads, plus its strip.

Assembles one layer's ``fillAuthor`` fact: the author's distinct colors, the
paired scale (when the caption and the colors prove one) and the strip the
panel draws. The entry point shipped to CONF lives here.
"""

from __future__ import annotations

from typing import Any

from branca.colormap import StepColormap
from folium.map import Layer

from ._fill_author_caption import pair_scale
from ._fill_author_colormap import continuous_stops, provable_equal_interval, rgba_hex
from ._fill_author_scale import (
    FILL_AUTHOR_CONTINUOUS_THRESHOLD,
    FILL_AUTHOR_STOPS,
    author_colors,
    geojson_data,
)


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
