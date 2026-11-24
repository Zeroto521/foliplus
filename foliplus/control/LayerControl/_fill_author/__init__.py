"""Per-feature fill metadata for a GeoJson, from the author's own record.

The fill-author code is four modules, one concern each:

- ``scale`` — the feature property read, color sampling and the
  ``FILL_AUTHOR_*`` thresholds;
- ``colormap`` — branca scale reads (mounted scales, samples,
  agreement counts, continuous stops);
- ``caption`` — pairing a scale to its layer through the caption
  and the color veto;
- ``payload`` — the ``fillAuthor`` record and its strip.

This package is the facade the rest of the control imports. It re-exports every
public name so ``from ._fill_author import fill_author, map_colormaps`` (and the
tests that read the module surface) stay stable while the code lives in four
navigable modules.
"""

from __future__ import annotations

from .caption import (
    caption_names_a_value,
    pair_scale,
    warn_refused_caption,
)
from .colormap import (
    colormap_sample,
    column_agreement,
    continuous_stops,
    map_colormaps,
    palette_hex,
    provable_equal_interval,
    rgba_hex,
    stepped_agreement,
)
from .payload import fill_author, scale_payload
from .scale import (
    FILL_AUTHOR_AGREE,
    FILL_AUTHOR_CONTINUOUS_THRESHOLD,
    FILL_AUTHOR_RGB_SLACK,
    FILL_AUTHOR_SAMPLE,
    FILL_AUTHOR_SCAN_LIMIT,
    FILL_AUTHOR_STOPS,
    FOLIUM_COLOR_PROP,
    author_colors,
    author_rows,
    feature_properties,
    fill_author_color,
    geojson_data,
    numeric_value,
    rgb,
    same_color,
)

__all__ = [
    "FILL_AUTHOR_AGREE",
    "FILL_AUTHOR_CONTINUOUS_THRESHOLD",
    "FILL_AUTHOR_RGB_SLACK",
    "FILL_AUTHOR_SAMPLE",
    "FILL_AUTHOR_SCAN_LIMIT",
    "FILL_AUTHOR_STOPS",
    "FOLIUM_COLOR_PROP",
    "author_colors",
    "author_rows",
    "caption_names_a_value",
    "colormap_sample",
    "column_agreement",
    "continuous_stops",
    "feature_properties",
    "fill_author",
    "fill_author_color",
    "geojson_data",
    "map_colormaps",
    "numeric_value",
    "pair_scale",
    "palette_hex",
    "provable_equal_interval",
    "rgb",
    "rgba_hex",
    "same_color",
    "scale_payload",
    "stepped_agreement",
    "warn_refused_caption",
]
