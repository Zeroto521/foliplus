"""Guard: JS snippets and GeoJSON must not be embedded as source literals.

This is the single entry point for "something embedded in source" detection.
Two payload classes are extracted to dedicated homes and must stay there:

- **Browser-test JS** lives in test/js/snippet/ and is read via
  conftest.snippet(). A triple-quoted page.evaluate(...) string is the banned
  shape: not linted, not typechecked, not covered by vitest.
- **GeoJSON** lives in test/data/<control>/geojson/<name>.geojson and is read
  via conftest.load_geojson / geojson_text (Python) or fixture.loadGeoJSON /
  loadFeature / loadGeometry (JS). A type: Feature / FeatureCollection
  multi-line object literal, or a coordinates block nested two or more levels
  deep, is the banned shape: it silently drifts from the fixture it was copied
  from (#967).

Scan targets: foliplus/**/*.py, foliplus/js/**/*.ts, test/js/**/*.ts,
test/python/**/*.py. Run without a browser (pure static scan). The
single-quoted regexes keep the banned tokens out of this file's own source, so
the guard does not flag itself.
"""

from __future__ import annotations

import re
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[3]
SELF_NAME = "test_embedded_payload.py"

# Floating surfaces whose interaction properties (touch-action,
# overscroll-behavior, z-index) are pinned elsewhere. Not scanned: the whole
# point is that payloads live in test/data/, not inline.
SCAN_ROOTS = [
    ROOT / "foliplus",
    ROOT / "test" / "js",
    ROOT / "test" / "python",
]

# ── Judgments: GeoJSON ────────────────────────────────────────────────────
# "type": "Feature" / "FeatureCollection" -- the GeoJSON type member. The
# escaped space keeps the token out of this file's own source, so the guard
# does not flag itself.
GEOJSON_TYPE = re.compile(r'"type":\s*"Feature(Collection)?"')
# "coordinates": -- the GeoJSON position member. Whether it is a real geometry
# (vs a flat centroid pair) is decided by array nesting depth, not the key.
COORDINATES = re.compile(r'"coordinates":')

# ── Judgments: inline browser-test JS ─────────────────────────────────────
# page.evaluate( followed by a triple-quote block: the inline-JS shape to ban.
# The single-quoted regex keeps the banned tokens out of this file's own
# source (the backslash-space escape means "page.evaluate(" + the quote block
# is never present verbatim), so the guard does not flag itself.
INLINE_JS = re.compile(r'page\.evaluate\(\s*"""')

# ── Whitelist: deliberate inline shapes, with the reason each stays ───────
# A match sitting in any of these constructs is not an embedded payload.
WHITELIST = {
    # conftest.feature_collection() is the SHARED wrapper tests call to build
    # a FeatureCollection from already-extracted features -- infrastructure,
    # not an embedded payload.
    "def feature_collection(": "shared conftest wrapper (builds FC from extracted features)",
    # test_label builds features from a coords *parameter* (a for-loop over
    # (lat, lng) pairs), not an embedded literal geometry.
    "_declared_label_layer": "builds features from a coords parameter (no inline geometry)",
    # turf.circle / turf.polygon: production calls (MeasureControl/mode/circle.ts,
    # core/geo/geodesic.ts) return default geometry -- computed output, not
    # inline data to extract.
    "turf.circle(": "default geometry of a production turf.circle call, not inline data",
    "turf.polygon(": "default geometry of a production turf.polygon call, not inline data",
    # predicate tests: hasFillLeaf / isArealStyleLeaf read geometry.type only;
    # a minimal Polygon-with-holes literal is the point of the test.
    "hasFillLeaf": "predicate test (geometry.type only; minimal shape is the point)",
    "isArealStyleLeaf": "predicate test (geometry.type only; minimal shape is the point)",
}


def _max_array_depth(text, start):
    """Nesting depth of the array literal beginning at start.

    [0, 0] is depth 1 (a flat pair -- a centroid, not geometry).
    [[0, 0], [1, 1]] is depth 2 (a ring / multi-point).
    [[[0, 0]]] is depth 3 (a polygon ring). Only depth >= 2 is a real
    geometry payload worth extracting to a fixture.
    """
    i = start
    n = len(text)
    while i < n and text[i] != "[":
        if text[i] in "]}":
            return 0
        i += 1
    if i >= n:
        return 0
    depth = 0
    max_depth = 0
    while i < n:
        ch = text[i]
        if ch == "[":
            depth += 1
            if depth > max_depth:
                max_depth = depth
        elif ch == "]":
            depth -= 1
            if depth == 0:
                return max_depth
        elif ch == "}" and depth == 0:
            return max_depth
        i += 1
    return max_depth


def _whitelisted(src, pos):
    """If the match at pos sits in a whitelisted construct, return why."""
    window = src[max(0, pos - 900) : pos + 200]
    for key, reason in WHITELIST.items():
        if key in window:
            return reason
    return None


def _scan_file(path):
    src = path.read_text(encoding="utf-8")
    rel = path.relative_to(ROOT).as_posix()
    offenders = []
    for m in GEOJSON_TYPE.finditer(src):
        line = src.count("\n", 0, m.start()) + 1
        reason = _whitelisted(src, m.start())
        if reason is None:
            offenders.append(f"{rel}:{line} inline GeoJSON type literal")
    for m in COORDINATES.finditer(src):
        depth = _max_array_depth(src, m.end())
        if depth >= 2:
            reason = _whitelisted(src, m.start())
            if reason is None:
                line = src.count("\n", 0, m.start()) + 1
                offenders.append(
                    f"{rel}:{line} inline coordinates array (depth {depth})"
                )
    return offenders


def _iter_scan_files():
    files = []
    for root in SCAN_ROOTS:
        if not root.exists():
            continue
        for pattern in ("*.py", "*.ts"):
            for path in sorted(root.rglob(pattern)):
                if "test/data/" in path.as_posix():
                    continue
                if path.name == SELF_NAME:
                    continue
                files.append(path)
    return files


def test_no_inline_geojson_payloads():
    offenders = []
    for path in _iter_scan_files():
        offenders.extend(_scan_file(path))
    assert not offenders, (
        "inline GeoJSON must be extracted to test/data/<control>/geojson/ and "
        "read via conftest.load_geojson (Python) or fixture.loadGeoJSON (JS): "
        + str(offenders)
    )


def test_depth_rule_distinguishes_geometry_from_flat_pairs():
    assert _max_array_depth("centroid: [0, 0]", 10) == 1
    assert _max_array_depth('"coordinates": [[0, 0], [1, 1]]', 14) >= 2
    assert _max_array_depth('"coordinates": [[[0, 0], [1, 1]]]', 14) == 3
    assert _max_array_depth('"coordinates": null', 14) == 0


def test_no_inline_multiline_js_in_python():
    offenders = []
    for path in sorted((ROOT / "test" / "python").rglob("*.py")):
        if path.name == SELF_NAME:
            continue
        src = path.read_text(encoding="utf-8")
        for m in INLINE_JS.finditer(src):
            line = src.count("\n", 0, m.start()) + 1
            offenders.append(f"{path.relative_to(ROOT)}:{line}")
    assert not offenders, (
        "multi-line page.evaluate JS must be extracted to test/js/snippet/ "
        f"via conftest.snippet(): {offenders}"
    )
