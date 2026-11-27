"""Normalisation for the caller-facing declarations.

Every caller-facing payload that reaches Python is a *declaration* rather than
a value the runtime computes: the zoom range, the filter, the folder, and the
per-layer label block. The verdict rule
is shared: a malformed declaration is reported once and then treated exactly
like "not declared", never as a reason to hide data or take the page down.

Each declaration family lives in its own module (key, warning, zoom_range,
filter, paint/fill, folder, label, marker, opacity, face); this package
re-exports the whole public surface, so foliplus._declaration.<name> keeps
working for every consumer.
"""

from __future__ import annotations

from .face import normalise_face_keys, normalise_icon_face, normalise_marker_face
from .fill import normalise_fill
from .filter import (
    FilterKind,
    enum_atom,
    json_number,
    normalise_layer_filter,
    normalize_declared_filter,
    range_atom,
)
from .folder import normalise_folder
from .key import (
    BORDER_KEY,
    FILL_KEY,
    FILTER_KEY,
    FOLDER_KEY,
    FOLDER_NAME_MAX,
    ICON_KEY,
    ICON_SIZE_KEY,
    LABEL_KEY,
    MARKER_COLOR_KEY,
    MARKER_KEY,
    MEASURE_TYPE_FIELD,
    OPACITY_KEY,
    ZOOM_RANGE_KEY,
)
from .label import NUMBER_FORMATS, normalise_label
from .marker import normalise_icon_size, normalise_marker_color
from .opacity import normalise_color_opacity, normalise_opacity
from .paint import (
    _HEX_COLOR_RE,
    _declared_hex,
    _declared_opacity,
    _declared_weight,
    _expand_hex,
    normalise_border,
)
from .warning import (
    LOG_FILTER_CAP,
    PACKAGE_DIR,
    caller_stacklevel,
    foliplus_reports,
    is_plumbing,
    refused_captions,
    should_report,
    warn_filter,
    warn_foliplus,
)
from .zoom_range import normalise_zoom_range, zoom_level

__all__ = [
    "BORDER_KEY",
    "FILL_KEY",
    "FILTER_KEY",
    "FOLDER_KEY",
    "FOLDER_NAME_MAX",
    "ICON_KEY",
    "ICON_SIZE_KEY",
    "LABEL_KEY",
    "LOG_FILTER_CAP",
    "MARKER_COLOR_KEY",
    "MARKER_KEY",
    "MEASURE_TYPE_FIELD",
    "NUMBER_FORMATS",
    "OPACITY_KEY",
    "PACKAGE_DIR",
    "ZOOM_RANGE_KEY",
    "FilterKind",
    "caller_stacklevel",
    "enum_atom",
    "foliplus_reports",
    "is_plumbing",
    "json_number",
    "normalise_border",
    "normalise_color_opacity",
    "normalise_face_keys",
    "normalise_fill",
    "normalise_folder",
    "normalise_icon_face",
    "normalise_icon_size",
    "normalise_label",
    "normalise_layer_filter",
    "normalise_marker_color",
    "normalise_marker_face",
    "normalise_opacity",
    "normalise_zoom_range",
    "normalize_declared_filter",
    "range_atom",
    "refused_captions",
    "should_report",
    "warn_filter",
    "warn_foliplus",
    "zoom_level",
]
