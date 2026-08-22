"""Centralized CDN version management.

All CDN dependency versions are defined here. Bump a version in one place to update it
across all controls.
"""

# HeatmapControl
H3 = "4"
SS = "7"
CHROMA = "2"

GCOORD = "1"  # MeasureControl / LocateControl / SearchControl
TURF = "7"  # MeasureControl

# ExportControl
GEOTIFF = "3.0.5"
PAKO = "2.1.0"
