#!/usr/bin/env python3
"""Replace old 4-arg distance/bearing/formatSegmentLabel calls with 2-arg point object calls.
Handles multi-line patterns robustly."""

import re
import sys

path = sys.argv[1]
with open(path) as f:
    content = f.read()

# Match MeasureUtils.distance(EXPR1.lng, EXPR1.lat, EXPR2.lng, EXPR2.lat)
# where EXPR1 and EXPR2 are the same expression in each pair
expr_pattern = r"[\w\[\]().\s\-\+]+?"
distance_pattern = r"MeasureUtils\.distance\(([\w\[\]().\s]+?)\.lng\s*,\s*\1\.lat\s*,\s*([\w\[\]().\s]+?)\.lng\s*,\s*\2\.lat\s*\)"


def replace_old_distance(m):
    return f"MeasureUtils.distance({m.group(1).strip()}, {m.group(2).strip()})"


content = re.sub(distance_pattern, replace_old_distance, content, flags=re.DOTALL)

# MeasureUtils.formatSegmentLabel(EXPR1.lng, EXPR1.lat, EXPR2.lng, EXPR2.lat, meters)
label_pattern = r"MeasureUtils\.formatSegmentLabel\(([\w\[\]().\s]+?)\.lng\s*,\s*\1\.lat\s*,\s*([\w\[\]().\s]+?)\.lng\s*,\s*\2\.lat\s*,\s*(\w+)\s*\)"


def replace_old_label(m):
    return f"MeasureUtils.formatSegmentLabel({m.group(1).strip()}, {m.group(2).strip()}, {m.group(3).strip()})"


content = re.sub(label_pattern, replace_old_label, content, flags=re.DOTALL)

# MeasureUtils.bearing(EXPR1.lng, EXPR1.lat, EXPR2.lng, EXPR2.lat)
bearing_pattern = r"MeasureUtils\.bearing\(([\w\[\]().\s]+?)\.lng\s*,\s*\1\.lat\s*,\s*([\w\[\]().\s]+?)\.lng\s*,\s*\2\.lat\s*\)"


def replace_old_bearing(m):
    return f"MeasureUtils.bearing({m.group(1).strip()}, {m.group(2).strip()})"


content = re.sub(bearing_pattern, replace_old_bearing, content, flags=re.DOTALL)

with open(path, "w") as f:
    f.write(content)

print("Done. All call sites updated.")
