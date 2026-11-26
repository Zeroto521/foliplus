"""The declaration-key vocabulary shared by every module in this package."""

from __future__ import annotations

#: The declaration key that asks for a visibility window over map zoom levels.
ZOOM_RANGE_KEY = "zoom_range"
#: The field the measurement-type filter is bound to. Mirrors
#: CONST.FILTER.FIELD in foliplus/js/MeasureControl/const.ts: the list form
#: emits it so CONF carries a complete AST atom.
MEASURE_TYPE_FIELD = "type"
#: The declaration key that asks for a layer folder.
FOLDER_KEY = "folder"
#: The longest folder name a declaration may carry, in Unicode code points.
#: A folder name is a short label read on a list row, not a data field: past
#: this the row's ellipsis hides everything and the value is far likelier a
#: pasted value than a name. Mirrors FOLDER_NAME_MAX in the JS reader
#: (LayerInfoRegistry), so Python and JS cannot disagree about which names
#: reach the panel. Measured after normalising, so whitespace padding cannot
#: disguise a long name and a padded name is judged by what the author sees.
FOLDER_NAME_MAX = 64
#: The per-layer fill declaration key.
FILL_KEY = "fill"
#: The per-layer label declaration key.
LABEL_KEY = "label"
#: The per-layer filter declaration key.
FILTER_KEY = "filter"
#: The per-layer border declaration key: the author declares a
#: border mode default (follow_fill) on the layer, read by the JS panel as a
#: read-time default under the user's stored choice.
BORDER_KEY = "border"
#: The per-layer marker chassis-colour declaration key: the author names one
#: of the runtime's marker chassis presets (markerColorPreset.ts) as a
#: read-time default. folium's named Icon colours are a DIFFERENT palette
#: (different hex values), so this chassis vocabulary is not expressible via
#: folium kwargs - that is why it is a foliplus declaration.
MARKER_COLOR_KEY = "marker_color"

#: The per-layer marker icon pixel-size declaration key: a whole-number pixel
#: size for the marker icon. folium's Icon carries a fixed pixel size and
#: exposes no scaling channel, so this too is a foliplus-only declaration.
ICON_SIZE_KEY = "icon_size"
#: The per-layer whole-layer opacity declaration key: a 0-1 number (Leaflet's
#: opacity unit) the panel's opacity slider starts at and Reset returns to.
#: folium's ``opacity=`` kwarg is the author's DRAW value; this declaration is
#: the panel's read-time default, so the two channels never fight.
OPACITY_KEY = "opacity"
#: The per-layer icon declaration block key: the icon face's sub-dimensions
#: (glyph, color, colorOpacity) ride one in-block mapping, the same shape
#: fill/border use.
ICON_KEY = "icon"
#: The per-layer marker declaration block key: the marker face's
#: sub-dimensions (color, colorOpacity) ride one in-block mapping.
MARKER_KEY = "marker"
