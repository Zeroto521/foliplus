"""Shared fixture + comparison helpers for the paint-dimension parity harness.

The browser-side sampler lives in test/js/browser/LayerControl/sample_paint_dimension.js
(a self-contained function); this module supplies the Python-side pieces both the
JS probe and the Python browser test reuse:

  - build_layers(): the three geometry layers (point / line / polygon), each with a
    numeric property so VALUE mode is offered, plus the mode matrix per geometry.
  - GOLDEN_PATH / load_golden / write_golden
  - compare(golden, snapshot): a list of human-readable diffs (structure is
    zero-tolerance; computed style uses the design's ±1px / ±0.01 tolerance).

The 21-group matrix from s6-parity-harness-design.md §2 is produced by
GEOM_MATRIX below (fill 3 modes × 3 geoms + border 4 modes × 3 geoms − the three
fill×inherit groups the fill dimension does not offer).

This is a TEST-ONLY module (it never imports production code on the Python side;
the production behavior is sampled through the real browser page).
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import folium
from conftest import load_geojson

# The 21-group sampling matrix. Each geometry offers the modes its own surface
# honestly supports; the probe records what is actually offered, and the golden
# locks the offering. A geometry that offers fewer modes simply has fewer
# groups — the matrix below is the FULL cross product, and the test samples the
# offered subset (the golden records `present: false` for a not-offered mode
# only if the probe is asked for it; the normal matrix asks only offered modes).
GEOMS = ("point", "line", "polygon")

# Fill modes every fill-capable layer with a numeric field offers. A fill-capable
# layer without a numeric field offers only original/solid (no VALUE).
FILL_MODES = ("original", "solid", "value")

# Border modes per geometry kind (from buildBorderRow):
#   - a line border carries the value (borderCarriesValue → geometry==LINE), so
#     it offers VALUE and never FOLLOW_FILL.
#   - a polygon/point border is an outline over a filled face, so it offers
#     FOLLOW_FILL and never VALUE.
BORDER_MODES = {
    "line": ("original", "solid", "value"),
    "polygon": ("original", "solid", "followFill"),
    "point": ("original", "solid", "followFill"),
}

GOLDEN_DIR = Path(__file__).resolve().parent / "golden"
GOLDEN_PATH = GOLDEN_DIR / "paint-dimension.json"


def _with_value(data: dict, key: str = "value") -> dict:
    """Deep-copy a GeoJSON feature collection and give every feature a numeric
    `value` property, so the layer offers the VALUE fill mode."""
    out = copy.deepcopy(data)
    for i, feat in enumerate(out["features"]):
        feat["properties"] = {**feat.get("properties", {}), key: 10 + i}
    return out


def build_layers() -> tuple[folium.GeoJson, folium.GeoJson, folium.GeoJson]:
    """The three geometry layers for the parity map.

    Each is a plain folium.GeoJson with a numeric `value` property per feature
    (so VALUE fill is offered) and a distinct layer name. Point / line / polygon
    are the three geometry classes the surface resolves (GEOM_TYPE).
    """
    # Polygon: the 3-offset fixture already carries a numeric `value`.
    polygon = folium.GeoJson(
        json.dumps(_with_value(load_geojson("common", "polygons_fuzhou_3offset"))),
        name="Polygons",
    )
    # Line: the diagonal line carries no property — add a numeric one.
    line = folium.GeoJson(
        json.dumps(_with_value(load_geojson("common", "line_fuzhou_diag"))),
        name="Lines",
    )
    # Point: the point fixture carries a string `name` — replace with numeric.
    point = folium.GeoJson(
        json.dumps(_with_value(load_geojson("common", "point_1193_2608"))),
        name="Points",
    )
    return point, line, polygon


def load_golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def write_golden(snapshot: dict) -> None:
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    GOLDEN_PATH.write_text(
        json.dumps(snapshot, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


# ── comparison (design §3) ──


def _computed_close(a: dict, b: dict, *, dx: float = 1, dv: float = 0.01) -> bool:
    """Computed-style comparison with the design's tolerances.

    Numeric lengths (width/height/gap) compare within ±1px; opacity within
    ±0.01; colors and keyword values compare exactly.
    """
    numeric = ("width", "height", "gap")
    floaty = ("opacity",)
    for k in numeric:
        if k in a and k in b and a[k] != b[k]:
            try:
                va = float(a[k].removesuffix("px"))
                vb = float(b[k].removesuffix("px"))
            except ValueError:
                return False
            if abs(va - vb) > dx:
                return False
    for k in floaty:
        if k in a and k in b and a[k] != b[k]:
            try:
                if abs(float(a[k]) - float(b[k])) > dv:
                    return False
            except ValueError:
                return False
    for k in (
        "display",
        "position",
        "flexDirection",
        "visibility",
        "color",
        "backgroundColor",
        "borderColor",
    ):
        if k in a and k in b and a[k] != b[k]:
            return False
    return True


def compare(golden: dict, snapshot: dict) -> list[str]:
    """Return a list of human-readable diffs between *golden* and *snapshot*.

    Empty list == parity. Structure / class-stack / aria are zero-tolerance
    (design §3.1); computed style uses the ±1px / ±0.01 tolerance (design §3.2).
    """
    diffs: list[str] = []
    for dim in ("fill", "border"):
        for mode in (
            FILL_MODES
            if dim == "fill"
            else ("original", "solid", "value", "followFill")
        ):
            for geom in GEOMS:
                g = golden.get(dim, {}).get(mode, {}).get(geom)
                s = snapshot.get(dim, {}).get(mode, {}).get(geom)
                if g is None and s is None:
                    continue
                if g is None or s is None:
                    diffs.append(
                        f"{dim}.{mode}.{geom}: presence changed ({g is not None} → {s is not None})"
                    )
                    continue
                # presence flags
                if g.get("present") != s.get("present"):
                    diffs.append(
                        f"{dim}.{mode}.{geom}: present {g.get('present')} → {s.get('present')}"
                    )
                    continue
                if not g.get("present"):
                    continue
                # class stack order (design §2.4) — zero tolerance
                if g.get("row", {}).get("cls") != s.get("row", {}).get("cls"):
                    diffs.append(
                        f"{dim}.{mode}.{geom}: row class stack {g.get('row', {}).get('cls')} → {s.get('row', {}).get('cls')}"
                    )
                if g.get("select", {}).get("cls") != s.get("select", {}).get("cls"):
                    diffs.append(
                        f"{dim}.{mode}.{geom}: select class stack {g.get('select', {}).get('cls')} → {s.get('select', {}).get('cls')}"
                    )
                # row structure (children 2 levels) — zero tolerance
                if g.get("row", {}).get("children") != s.get("row", {}).get("children"):
                    diffs.append(f"{dim}.{mode}.{geom}: row children changed")
                if g.get("detail", {}).get("children") != s.get("detail", {}).get(
                    "children"
                ):
                    diffs.append(f"{dim}.{mode}.{geom}: detail children changed")
                # aria — zero tolerance
                if g.get("row", {}).get("aria") != s.get("row", {}).get("aria"):
                    diffs.append(
                        f"{dim}.{mode}.{geom}: row aria {g.get('row', {}).get('aria')} → {s.get('row', {}).get('aria')}"
                    )
                if g.get("select", {}).get("aria") != s.get("select", {}).get("aria"):
                    diffs.append(
                        f"{dim}.{mode}.{geom}: select aria {g.get('select', {}).get('aria')} → {s.get('select', {}).get('aria')}"
                    )
                # computed style — tolerance
                for key in ("detail", "select"):
                    gc = g.get(key, {}).get("computed")
                    sc = s.get(key, {}).get("computed")
                    if (gc is None) != (sc is None):
                        diffs.append(
                            f"{dim}.{mode}.{geom}: {key} computed presence changed"
                        )
                        continue
                    if gc is not None and not _computed_close(gc, sc):
                        diffs.append(
                            f"{dim}.{mode}.{geom}: {key} computed style drifted"
                        )
                for key in ("color", "number"):
                    gc = g.get("keyComputed", {}).get(key)
                    sc = s.get("keyComputed", {}).get(key)
                    if (gc is None) != (sc is None):
                        diffs.append(
                            f"{dim}.{mode}.{geom}: {key} computed presence changed"
                        )
                        continue
                    if gc is not None and not _computed_close(gc, sc):
                        diffs.append(
                            f"{dim}.{mode}.{geom}: {key} computed style drifted"
                        )
    return diffs
