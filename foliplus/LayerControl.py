from __future__ import annotations

import json
import logging
import math
import numbers
import os
import sys
import warnings
from collections.abc import Iterable
from pathlib import Path
from types import FrameType
from typing import Annotated, Any, cast

import folium
from branca.colormap import LinearColormap, StepColormap
from branca.element import Element
from folium import GeoJson
from folium.map import Layer

from ._config_schema import FieldSpec
from ._typing import ControlPosition
from .BaseControl import BaseControl
from .locale import LocaleConfig

_FOLIUM_COLOR_PROP = "__folium_color"

_log = logging.getLogger(__name__)
# The panel only draws the strip: 64 samples are enough for a continuous
# scale (a LinearColormap carries 256 stops) and keep CONF small.
_FILL_AUTHOR_STOPS = 64
# Features sampled for the checks that validate a caption. One sample feeds
# both rules: the stepped test requires every row to carry one of the scale's
# blocks, so more rows only make that veto stricter, while the continuous test
# reads its bar off the same rows (8 of 12 must match, so four features the
# scale does not paint are still tolerated). 12 keeps both checks at a fraction
# of a millisecond.
_FILL_AUTHOR_SAMPLE = 12
# Features scanned for the distinct-color strip. The strip is a preview and the
# panel only needs "at least two colors" plus 64 samples, so a low-cardinality
# layer must not cost a full walk: past this budget the record is capped.
_FILL_AUTHOR_SCAN_LIMIT = 4_096
# Per-channel slack when comparing a colormap color with __folium_color:
# branca's hex and the leaf's property round differently (measured max 2/255
# over 40 features of a plasma and a viridis scale).
_FILL_AUTHOR_RGB_SLACK = 2
# Pairing threshold, continuous arm only: the stepped arm tests exact block
# membership instead, so only _column_agreement reads this. A scale mounted on
# its own layer reproduces every sampled hex (measured 12/12, and 200/200 over
# 200 random values). On an evenly spread sample no foreign palette comes near
# the bar: 0 of the 132 ordered pairs of RdYlBu_09, RdYlGn_09, Spectral_11,
# PiYG_09, BrBG_09, viridis, plasma, inferno, magma, Blues_09, Reds_09 and
# YlOrRd_09 reached it, the best being RdYlBu_09 vs RdYlGn_09 at 5/12. Two
# things it is not — not arithmetic slack, since _FILL_AUTHOR_RGB_SLACK covers
# the rounding (values rounded to whole numbers still match 12/12), and not
# proof: palettes sharing stops are not separated. RdYlBu_09 and RdYlGn_09
# share four, so a layer sorted by the painted value samples that shared low
# end and agrees 12/12, and this bar accepts the foreign scale. What it does
# buy is a layer the scale paints only mostly: four features hand-set still
# agree 8/12 = 0.67, five drop it to 7/12 = 0.58.
_FILL_AUTHOR_AGREE = 0.6

#: The keys the per-layer foliplus={...} declaration namespace accepts.
#: fill and label are consumed by the JS panel straight off
#: layer.options.foliplus (folium forwards the unknown keyword into the
#: layer options); zoom is normalised here into CONFIG data[].zoom so the
#: visibility policy reads one CONF fact instead of the raw namespace.
_FOLIPLUS_KEYS = frozenset({"fill", "label", "zoom"})


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
    rather than a guess: a declaration is read during the Jinja render, which
    compiles the control template to a "<template>" frame and calls through its
    own interpreter frames, so between this package and the author's cell sit
    the template frame, jinja2 and folium. The depth also differs between call
    paths (_reject sits one frame further in than the shape checks). Walking
    out to the first frame that is not plumbing is therefore the only stable
    rule. Same idea as _declared_filter._caller_stacklevel on the
    declared-filter branch (#805), kept as a private copy on purpose: the two
    branches land independently, and a shared module would be an add/add
    conflict to resolve for no behaviour. Fold them together in a follow-up
    once both are in - the difference to reconcile is the dependency skip,
    which #805's construction-time warnings do not need.
    """
    frame: FrameType | None = sys._getframe(1)  # _warn_foliplus, its caller
    level = 1
    while frame is not None:
        if not _is_plumbing(frame.f_code.co_filename):
            return level
        frame = frame.f_back
        level += 1
    return level  # pragma: no cover - only when the whole stack is library code


def _warn_foliplus(note: str, message: str) -> None:
    """Report one unusable foliplus={...} declaration at the line that wrote it.

    De-duplicated through the same process-wide log filter as the refused
    captions (see _should_report below): the note carries the layer name and
    the defect, so one typo on three layers prints three attributable warnings
    and re-rendering the same page stays quiet. Never raises: a typo in the
    declaration namespace is a warning, not a page failure.
    """
    if not _should_report(("foliplus", note), _foliplus_reports):
        return
    warnings.warn(message, UserWarning, stacklevel=_caller_stacklevel())


def _zoom_level(raw: object) -> int | None:
    """One declared zoom end as an int, or None when it is not an integer.

    bool is an int subclass but never a zoom level, so it is rejected too.
    Returning the narrowed value keeps the caller's comparison and dict in int
    territory; a loop-body isinstance check does not narrow past the loop, so
    validating in a loop and using the names afterwards would need a second
    round of checks here (or a cast) for no behavioural gain.
    """
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    return None


def _declared_zoom(item: Layer, layer_name: str) -> dict[str, int] | None:
    """Normalise one layer foliplus={"zoom": {"min": ..., "max": ...}}.

    Returns {"min": int, "max": int} when the declaration is usable, else
    None: "not declared" and "declared but invalid" are the same state
    downstream - the visibility policy stays unconstrained rather than
    hiding the layer on a payload the author never saw validated.

    The namespace is a folium passthrough, so nothing validates it at
    construction. This is the single read point, hence the single place that
    warns; every message names the layer so a typo is attributable, and the
    de-duplication note carries the layer and the defect so two different
    layers (or two different typos) are each reported once.
    """
    # folium's base Layer (map.py) never assigns self.options: only the
    # concrete subclasses do (Marker, GeoJson, FeatureGroup, TileLayer, ...).
    # A bare Layer or a custom subclass is therefore a real runtime shape, not
    # just a type hole, and it simply carries no declaration.
    raw = getattr(item, "options", {}).get("foliplus")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        _warn_foliplus(
            f"{layer_name}:shape:{type(raw).__name__}",
            f"LayerControl: layer {layer_name!r} declares foliplus= as "
            f"{type(raw).__name__}; expected a mapping - ignored",
        )
        return None

    for key, value in raw.items():
        if key not in _FOLIPLUS_KEYS:
            _warn_foliplus(
                f"{layer_name}:unknown:{key}",
                f"LayerControl: layer {layer_name!r} declares unknown "
                f"foliplus key {key!r}; expected one of "
                f"{sorted(_FOLIPLUS_KEYS)} - ignored",
            )
        elif key in {"fill", "label"} and not isinstance(value, dict):
            _warn_foliplus(
                f"{layer_name}:shape:{key}:{type(value).__name__}",
                f"LayerControl: layer {layer_name!r} declares "
                f"foliplus[{key!r}] as {type(value).__name__}; expected a "
                "mapping - ignored",
            )

    zoom = raw.get("zoom")
    if zoom is None:
        return None

    def _reject(reason: str) -> None:
        _warn_foliplus(
            f"{layer_name}:zoom:{reason}",
            f"LayerControl: layer {layer_name!r} declares "
            f"foliplus[zoom] {reason} - ignored",
        )

    if not isinstance(zoom, dict):
        _reject(f"as {type(zoom).__name__}; expected a mapping")
        return None
    extra = sorted(set(zoom) - {"min", "max"})
    if extra:
        _reject(f"with unknown key(s) {extra}; expected only min and max")
        return None
    raw_lo, raw_hi = zoom.get("min"), zoom.get("max")
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


def _fill_author_color(props: dict[str, Any]) -> str | None:
    """The feature's declarative color, when explore wrote one."""
    color = props.get(_FOLIUM_COLOR_PROP)
    return color if isinstance(color, str) else None


def _geojson_data(item: Layer) -> dict[str, Any] | None:
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


def _feature_properties(feature: object) -> dict[str, Any] | None:
    """A feature's properties mapping, or None for a malformed feature."""
    props = feature.get("properties") if isinstance(feature, dict) else None
    return props if isinstance(props, dict) else None


def _author_colors(features: list[Any]) -> tuple[list[str], bool]:
    """Distinct declared colors in first-seen order, within a bounded scan.

    Only features that carry the property contribute, so a partially colored
    layer still reports the colors it has. The panel needs "at least two
    colors" plus a strip, so the scan stops as soon as a color beyond the cap
    shows up and it never walks more than _FILL_AUTHOR_SCAN_LIMIT features: a
    low-cardinality 20,000-feature layer would otherwise pay a full walk only to
    learn that it has four colors. The sample is strided across the whole list
    rather than taken from its head, because a layer sorted by the painted
    value would otherwise show only its first class and read as a single-color
    layer. The flag says the strip cap was hit, which the caption shows as
    "N+".
    """
    seen: dict[str, None] = {}
    total = len(features)
    if total > _FILL_AUTHOR_SCAN_LIMIT:
        indices: Iterable[int] = (
            index * total // _FILL_AUTHOR_SCAN_LIMIT
            for index in range(_FILL_AUTHOR_SCAN_LIMIT)
        )
    else:
        indices = range(total)
    for index in indices:
        props = _feature_properties(features[index])
        if props is None:
            continue
        color = _fill_author_color(props)
        if color is None or color in seen:
            continue
        seen[color] = None
        if len(seen) > _FILL_AUTHOR_STOPS:
            return list(seen)[:_FILL_AUTHOR_STOPS], True
    return list(seen), False


def _author_rows(features: list[Any]) -> list[tuple[dict[str, Any], str]]:
    """A bounded sample of (properties, color) rows for the color checks."""
    rows: list[tuple[dict[str, Any], str]] = []
    for feature in features:
        props = _feature_properties(feature)
        if props is None:
            continue
        color = _fill_author_color(props)
        if color is None:
            continue
        rows.append((props, color))
        if len(rows) >= _FILL_AUTHOR_SAMPLE:
            break
    return rows


def _numeric_value(value: object) -> float | None:
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


def _rgb(color: str) -> tuple[int, int, int] | None:
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


def _same_color(left: str, right: str) -> bool:
    """Whether two hex colors agree within the rounding slack."""
    left_rgb = _rgb(left)
    right_rgb = _rgb(right)
    if left_rgb is None or right_rgb is None:
        return False
    return all(
        abs(a - b) <= _FILL_AUTHOR_RGB_SLACK for a, b in zip(left_rgb, right_rgb)
    )


def _map_colormaps(node: Any) -> list[Any]:
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


def _colormap_sample(colormap: Any, value: object) -> str | None:
    """The scale's hex color at one value, or None when it cannot sample."""
    try:
        return str(colormap(value))[:7]
    except (TypeError, ValueError):
        return None


def _column_agreement(
    colormap: Any,
    rows: list[tuple[dict[str, Any], str]],
    column: str,
) -> tuple[int, int]:
    """How many sampled features of one column the scale reproduces."""
    hits = total = 0
    for props, color in rows:
        value = _numeric_value(props.get(column))
        if value is None:
            continue
        sample = _colormap_sample(colormap, value)
        if sample is None:
            continue
        total += 1
        hits += _same_color(sample, color)
    return hits, total


def _caption_names_a_value(
    rows: list[tuple[dict[str, Any], str]], caption: str
) -> bool:
    """Whether any sampled feature carries the caption as a numeric value.

    The check runs over the whole sample, not its first row: a layer painted
    with ``missing_kwds`` colors its missing features too, so a feature whose
    value is NaN can open the sample. One missing value must not talk the scale
    out of the whole layer — the color check skips that row anyway.
    """
    for props, _ in rows:
        if caption in props and _numeric_value(props[caption]) is not None:
            return True
    return False


def _stepped_agreement(
    colormap: Any,
    rows: list[tuple[dict[str, Any], str]],
    column: str,
) -> tuple[int, int]:
    """How many sampled features carry one of a classified scale's own blocks.

    A stepped scale paints discrete blocks, so membership is exact and needs no
    probability bar: its own layer is painted in exactly those block colors,
    even when a feature's value falls on the far side of a mapclassify bin edge
    and the scale would draw the adjacent class. A scale the layer was not
    painted with normally contributes no block the features carry: on an evenly
    spread sample none of the 132 ordered pairs of the palettes listed at
    _FILL_AUTHOR_AGREE was accepted. Palettes that share a stop are not
    separated — 10 of those pairs do within _FILL_AUTHOR_RGB_SLACK, RdYlBu_09
    and RdYlGn_09 share four — and a layer sorted by the painted value samples
    one shared block, so such a scale is accepted at 12/12. Membership is the
    whole test, not proof that the scale is the author's.
    """
    blocks = [
        hex_color
        for color in getattr(colormap, "colors", ())
        if (hex_color := _palette_hex(color)) is not None
    ]
    hits = total = 0
    for props, color in rows:
        if _numeric_value(props.get(column)) is None:
            continue
        total += 1
        hits += any(_same_color(block, color) for block in blocks)
    return hits, total


def _pair_scale(
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
    rows = _author_rows(features)
    if not rows:
        return None
    for colormap in colormaps:
        if id(colormap) in claimed:
            continue
        caption = getattr(colormap, "caption", None)
        if not isinstance(caption, str) or not _caption_names_a_value(rows, caption):
            continue
        if isinstance(colormap, StepColormap):
            # Discrete blocks are exactly comparable, so the class colors are
            # the test: a feature painted by this scale always carries one of
            # its k blocks, whichever side of a bin edge its value sits on.
            hits, total = _stepped_agreement(colormap, rows, caption)
            agrees = total == 0 or hits == total
        else:
            hits, total = _column_agreement(colormap, rows, caption)
            agrees = not total or hits / total >= _FILL_AUTHOR_AGREE
        if not agrees:
            _warn_refused_caption(caption, hits, total)
            continue
        claimed.add(id(colormap))
        return colormap, caption
    return None


# Diagnostics already reported in this process, so re-rendering a page does not
# repeat the same line for the same data: one refused caption is a signal, and a
# two-layer map measured 16 identical warnings. Each set is a log filter, not
# state — it is cleared rather than grown when a long process renders many maps.
# Split per family (#804): the caption refusal (#781) and the foliplus={...}
# declaration rejections each own a 64-note budget, so a flood of malformed
# declarations cannot clear the caption history (or vice versa) — each family's
# dedup only needs to remember its own notes. Notes are string tuples whose
# first element is the domain tag, kept so a note is self-describing when a
# store is inspected or logged.
_refused_captions: set[tuple[str, ...]] = set()
_foliplus_reports: set[tuple[str, ...]] = set()

_LOG_FILTER_CAP = 64


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


def _warn_refused_caption(caption: str, hits: int, total: int) -> None:
    """Report a refused caption once per (caption, agreement) pair."""
    if not _should_report(("caption", caption, str(hits), str(total)), _refused_captions):
        return
    _log.warning(
        "LayerControl: the scale caption %r names a column, but only %d/%d "
        "sampled features match its colors; not claiming it",
        caption,
        hits,
        total,
    )


def _rgba_hex(color: object) -> str | None:
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


def _palette_hex(color: object) -> str | None:
    """One palette stop as #rrggbb: a 0..1 RGBA tuple, or a hex string."""
    if isinstance(color, str):
        raw = color.strip().lower()
        if not raw.startswith("#") or len(raw) not in (4, 7, 9):
            return None
        if len(raw) == 4:
            return "#" + "".join(channel * 2 for channel in raw[1:])
        return raw[:7]
    return _rgba_hex(color)


def _continuous_stops(colormap: Any) -> list[str]:
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
    if len(points) <= _FILL_AUTHOR_STOPS:
        picks = list(range(len(points)))
    else:
        step = (len(points) - 1) / (_FILL_AUTHOR_STOPS - 1)
        picks = [round(index * step) for index in range(_FILL_AUTHOR_STOPS)]
    colors = getattr(colormap, "colors", None)
    if isinstance(colors, (list, tuple)) and len(colors) == len(points):
        stops: list[str] = []
        for at in picks:
            hex_color = _palette_hex(colors[at])
            if hex_color is not None:
                stops.append(hex_color)
        return stops
    stops = []
    for at in picks:
        sample = _colormap_sample(colormap, points[at])
        if sample is not None:
            stops.append(sample)
    return stops


def _scale_payload(
    colormap: Any, column: str | None
) -> tuple[dict[str, Any], list[str]]:
    """The scale record the panel reads, plus the strip it draws.

    A continuous scale ships 64 sampled colors; a classified one ships the
    author's own blocks, because those are what the author's map shows.
    """
    stepped = isinstance(colormap, StepColormap)
    if stepped:
        stops = [
            hex_color
            for color in colormap.colors
            if (hex_color := _rgba_hex(color)) is not None
        ]
    else:
        stops = _continuous_stops(colormap)
    scale: dict[str, Any] = {
        "kind": "stepped" if stepped else "continuous",
        "vmin": float(colormap.vmin),
        "vmax": float(colormap.vmax),
    }
    if column is not None:
        # A column is named only on evidence: a scale is shipped only after its
        # caption named a numeric property of the layer and the sampled colors
        # agreed with it. The None arm exists for a hand-built record (tests)
        # and must not invent a name.
        scale["column"] = column
    if stepped:
        scale["levels"] = len(colormap.colors)
        # The author's real class edges: the panel states the classification
        # instead of re-deriving one. np.float64 is not JSON-serializable.
        scale["breaks"] = [float(edge) for edge in colormap.index]
    return scale, stops[:_FILL_AUTHOR_STOPS]


def _fill_author(
    item: Layer,
    colormaps: list[Any],
    claimed: set[int],
) -> dict[str, Any] | None:
    """Per-feature fill metadata for a folium GeoJson, from its own record.

    Reads properties.__folium_color, which geopandas.explore writes for every
    feature; a style_function layer has no such property and returns None, so
    JavaScript keeps the normal single-color arms for it. When the author also
    declared a scale (a branca colormap on the map), it is shipped as
    ``scale`` only when its caption names one of the layer's numeric properties
    and the sampled colors confirm it; otherwise the record still names how
    many distinct colors the layer paints and samples them for the strip. The
    caption is the declaration and the colors are the veto, so the column is
    the author's string and never a guess.
    """
    data = _geojson_data(item)
    if data is None:
        return None
    features = data.get("features")
    if not isinstance(features, list):
        return None
    colors, capped = _author_colors(features)
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
    paired = _pair_scale(colormaps, features, claimed)
    if paired is None:
        return payload
    colormap, column = paired
    scale, stops = _scale_payload(colormap, column)
    if stops:
        payload["scale"] = scale
        payload["stops"] = stops
    return payload


class LayerControl(BaseControl):
    """Layer panel to organize, inspect, style, and filter map layers.

    - 📐 Geometry-type icons for quick layer identification.
    - 🔀 Drag-and-drop reordering within a section, synced to Leaflet render
      order.
    - ✅ Multi-select checkboxes with z-index stacking, plus a toggle for all
      layers in a section.
    - 🎨 Solid-color replacement for base maps.
    - 🎨 Fill by value: color a layer by a numeric field with a classification
      method, class count, and scheme, or use a single fill color.
    - 🧰 Per-layer style drawer: opacity, zoom range, border, fill, size, and
      text labels with color, size, number format, and overlap control.
    - 🔎 Filter a layer's features live: a range on a numeric field, or a set
      of values on a categorical one, with a kept/total readout and a Clear
      action.
    - 🗂️ Row actions: rename, attributes, style, filter, and delete or clear
      with confirmation.
    - 💾 Panel state (order, visibility, folds, names, styles) persists across
      reloads.
    - 🏷️ Per-layer text labels via ``foliplus={"label": {"field": ...}}`` on
      the layer itself.
    - ⌨️ Keyboard navigation across rows and panels (see Shortcuts below).
    - 🎯 Zoom the map to a layer's extent (double-click / ⋮ / Alt+Enter).

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - ArrowUp
         - Move focus to previous layer
       * - ArrowDown
         - Move focus to next layer
       * - ArrowLeft
         - Toggle visibility of focused layer (deselect)
       * - ArrowRight
         - Toggle visibility of focused layer (select)
       * - Space
         - Toggle visibility of focused layer
       * - Enter
         - Toggle visibility of focused layer
       * - Ctrl+Up
         - Move focused layer one position up
       * - Ctrl+Down
         - Move focused layer one position down
       * - Escape
         - Close the open rename, menu, attributes, filter, or style panel;
           otherwise cancel focus and clear the keyboard cursor
       * - Double-click row
         - Zoom the map to that layer's extent (dashed rect). Hidden layers
           show a hint instead. Also from the ⋮ menu or Alt+Enter.
       * - Alt+Enter
         - Zoom to the focused layer (same as double-click)
       * - ⋮ menu
         - Enter or Space activates the focused item, Tab moves between items,
           Escape closes the menu

    On macOS, Cmd acts as the modifier key instead of Ctrl.

    Base basemap, color picker, and hidden rows stay quiet: no cursor glow
    on click or keyboard focus. Their ⋮ "Focus layer" item is disabled
    (not-allowed cursor) — toggle visibility from the checkbox as usual.

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    label_collide : bool, default True
        Page-wide default for the per-layer "avoid overlap" setting: when
        enabled, a layer's own labels thin themselves out where they overlap.
        Labels from *different* layers never avoid each other — the layers are
        stacked, so an upper layer simply covers the lower one's. The style
        panel overrides this per layer.

    collapse_on_outside : bool, default False
        Whether a press outside the panel collapses it. Off by default: the
        panel is a working surface read at the same time as the map, and the
        map's busiest gesture is drag-pan / click-select. The header close
        button collapses it explicitly either way.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import LayerControl
    >>> m = folium.Map()
    >>> LayerControl().add_to(m)

    Notes
    -----
    A layer may declare its own label defaults on the layer itself:

    >>> gdf.explore(
    ...     foliplus={"label": {"field": "name", "collide": False}}
    ... )

    .. list-table::
       :header-rows: 1

       * - Key
         - Default
         - Meaning
       * - ``field``
         - labels stay off
         - the feature property to label; declaring it turns labels on
       * - ``format``
         - ``auto``
         - number format (``auto`` / ``int`` / ``comma`` / ``percent``)
       * - ``color``
         - ``#ffffff``
         - label color; hex only, ``#rgb`` is normalised to ``#rrggbb``
       * - ``size``
         - ``11`` px
         - label font size in px, clamped to the panel's 6-32 range
       * - ``collide``
         - page-level ``label_collide``
         - whether this layer's labels take part in overlap avoidance
       * - ``show``
         - ``True`` once ``field`` is declared
         - explicit on/off, so a field can be named without drawing

    Keys stay short because the declaration's own namespace already says
    label; the ``label_`` prefix belongs to the flat surfaces (Python
    kwargs, CONF, locale). A declaration is the author's default: a later
    choice in the style panel is the user's intent and wins, and Reset
    shows the declaration through again.

    A layer may declare its own fill on the same per-layer namespace, under
    the ``fill`` key:

    >>> gdf.explore(
    ...     foliplus={"fill": {"ramp": {"field": "score", "scheme": "Reds"}}}
    ... )

    .. list-table::
       :header-rows: 1

       * - Key
         - Default
         - Meaning
       * - ``mode``
         - ``ramp`` once ``ramp.field`` is declared, otherwise ``solid``
         - fill arm: one color (``solid``) or color by value (``ramp``)
       * - ``ramp.field``
         - - (declaring it turns the ramp on)
         - the numeric feature property to classify
       * - ``ramp.method``
         - ``jenks``
         - classification method (``jenks`` / ``quantile`` / ``equal`` / ``heads``)
       * - ``ramp.classes``
         - ``6``
         - number of classes, any integer ``>= 2`` (``12`` is a common example)
       * - ``ramp.scheme``
         - ``Viridis``
         - palette name (the style panel's own candidates)

    Precedence matches the label declaration: the user's choice in the style
    panel wins, then the declaration, then the author's per-feature paint
    (``explore``'s baked colors) and finally the built-in default. Reset
    returns to the declared ramp. An invalid declaration only warns and falls
    back; it never paints a ramp the author did not ask for.

    A layer may declare its own visible zoom range on the same per-layer
    namespace, under the ``zoom`` key:

    >>> gdf.explore(foliplus={"zoom": {"min": 8, "max": 12}})

    .. list-table:
       :header-rows: 1

       * - Key
         - Default
         - Meaning
       * - ``min``
         - the map's minimum zoom
         - lowest zoom at which the layer is visible (inclusive)
       * - ``max``
         - the map's maximum zoom
         - highest zoom at which the layer is visible (inclusive)

    Precedence matches the label and fill declarations: the user's choice in
    the style panel wins, then the declaration, then the map's own range. A
    declaration that cannot intersect the map's zoom levels (author [20, 30]
    on a map capped at 18) is not a reason to hide the layer: the policy
    treats it as undeclared and warns once, and the panel's row is disabled
    with a hint instead of offering a collapsed value a drag would persist.
    An invalid declaration only warns and falls back; it never hides the
    layer on a payload the author never saw validated.
    """

    # Emitted by _extra_config at render time rather than set by a constructor
    # parameter, so it is declared here instead of in __init__ — declared the
    # same way a parameter is, with its alias name and shape in the FieldSpec.
    _dynamic_fields = {
        "data": Annotated[
            list,
            FieldSpec(
                name="LayerData",
                shape=[
                    {
                        "name": "string",
                        "id": "string",
                        "role": ("base", "overlay"),
                        "show": "bool",
                        # Optional: what Python computed for the author's
                        # per-feature paint (explore's baked colors). The panel
                        # reads it as the author default behind fill by value;
                        # absent on a layer with no author paint.
                        "fillAuthor": (
                            {
                                "perFeature": "bool",
                                "distinct": "number",
                                "stops": "array_string",
                                "capped": ("bool", "?"),
                                # The scale the author mounted (continuous) or
                                # the classified blocks they drew (stepped).
                                "scale": (
                                    {
                                        "kind": ("continuous", "stepped"),
                                        "column": ("string", "?"),
                                        "vmin": "number",
                                        "vmax": "number",
                                        "levels": ("number", "?"),
                                    },
                                    "?",
                                ),
                            },
                            "?",
                        ),
                        # Optional: the author-declared zoom range,
                        # normalised from foliplus={"zoom": {...}}. Absent
                        # when the layer declares none - the visibility
                        # policy then keeps the map range.
                        "zoom": ({"min": "number", "max": "number"}, "?"),
                    }
                ],
            ),
        ]
    }

    def __init__(
        self,
        *,
        position: ControlPosition = "topleft",
        label_collide: bool = True,
        collapse_on_outside: bool = False,
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__(position=position, locale=locale)
        self.label_collide = label_collide
        self.collapse_on_outside = collapse_on_outside

    def _extra_config(self) -> dict[str, object]:
        """Collect layers from the parent map at render time.

        This is the canonical example of a control that needs render-time data the
        constructor cannot know: the layer list only exists once the control is added
        to a map. Layers may be attached to the control itself (the usual case, since
        ``.add_to(control)`` is how layers are grouped for display) or to the parent
        map (the historical case). Candidates from both are unioned and deduplicated
        by ``get_name()``, because folium's ``add_child`` stores elements in an
        ``OrderedDict`` under that name — the same ``Layer`` reached twice collapses
        to one key, distinct layers never collide.

        Returns
        -------
        dict
            ``{"data": [{"name", "id", "role", "show"}, ...]}`` with optional
            ``fillAuthor`` / ``zoom`` — the ``data`` key is merged into the JS
            ``CONFIG`` object by :meth:`BaseControl._build_config`.
        """
        data: list[dict[str, object]] = []
        seen: set[str] = set()
        candidates: list[Element] = [*self._children.values()]
        if (parent := self._parent) is not None:
            candidates += [*parent._children.values()]
        # The explore scales live on the map, not on the layer: read them once
        # for the whole pass, from the control's own parent chain (see
        # _map_colormaps). ``claimed`` keeps one scale per layer.
        colormaps = _map_colormaps(self)
        claimed: set[int] = set()

        for item in candidates:
            # isinstance first — the control itself is a child but not a Layer
            # (and has no `.control` attribute).
            if not isinstance(item, Layer) or not item.control:
                continue
            if (name := item.get_name()) in seen:
                continue
            seen.add(name)

            entry: dict[str, object] = {
                "name": item.layer_name,
                "id": name,
                "role": "overlay" if item.overlay else "base",
                "show": bool(item.show),
            }
            author = _fill_author(item, colormaps, claimed)
            if author is not None:
                entry["fillAuthor"] = author
            zoom = _declared_zoom(item, item.layer_name)
            if zoom is not None:
                entry["zoom"] = zoom
            data.append(entry)

        # Stable ordering: overlays first, then base layers (matches JS enforceOrder).
        data.sort(key=lambda d: d["role"] == "base")
        return {"data": data}
