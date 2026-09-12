"""Asset-availability contract tests.

The historical failure mode: ``dist/`` is gitignored, so a release built
without the JS/CSS gate produced a wheel that installed, imported, and
rendered maps with no controls at all. Nothing raised — the missing files
just read as ``""``.

These tests pin the opposite: a missing artifact is always a loud failure,
at whichever point the pipeline first touches it, and a real distribution
really does carry the artifacts.
"""

from __future__ import annotations

import glob
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

import folium
import pytest
from conftest import render

from foliplus.BaseControl import (
    MissingAssetsError,
    _build_component_template,
    _build_shared_header,
    _load_asset,
    dist_dir,
)
from foliplus.ExportControl import ExportControl
from foliplus.SearchControl import SearchControl

# Every control class this change set ships a widget for.
COMPONENTS = (
    "ExportControl",
    "FullscreenControl",
    "HeatmapControl",
    "LayerControl",
    "LocateControl",
    "MeasureControl",
    "ScaleControl",
    "SearchControl",
)

SHARED = ("foliplus-common.min.js", "foliplus-common.min.css")

# Member names relative to the package root, as the archive spells them.
EXPECTED = [
    *SHARED,
    *(f"foliplus-{c}.{ext}" for c in COMPONENTS for ext in ("min.js", "min.css")),
]


def _clear() -> None:
    _build_shared_header.cache_clear()
    _build_component_template.cache_clear()


# ── Missing-asset behaviour ─────────────────────────────────────────


def test_load_asset_missing_js_not_empty():
    """The silent `""` return is what produced the empty-shell packages."""
    with pytest.raises(MissingAssetsError, match="NoSuch") as exc:
        _load_asset(dist_dir / "foliplus-NoSuchControl.min.js")
    assert "bundled assets missing" in str(exc.value)


def test_load_asset_missing_css():
    with pytest.raises(MissingAssetsError, match="min.css"):
        _load_asset(dist_dir / "foliplus-NoSuchControl.min.css")


def test_error_paths_are_repo_relative():
    """A traceback from an installed copy must not point at the source tree."""
    err = MissingAssetsError([dist_dir / "foliplus-common.min.js"])
    assert "foliplus/dist" in str(err).replace("\\", "/")


def test_error_is_a_runtime_error():
    assert issubclass(MissingAssetsError, RuntimeError)


def test_shared_header_names_both_files(base_map: folium.Map):
    """Both shared artifacts missing → one error naming both, not two failures."""
    js = dist_dir / "foliplus-common.min.js"
    css = dist_dir / "foliplus-common.min.css"
    t_j, t_c = js.read_text(encoding="utf-8"), css.read_text(encoding="utf-8")
    _clear()
    try:
        js.unlink()
        css.unlink()
        with pytest.raises(MissingAssetsError, match="make build-js") as exc:
            _build_shared_header()
    finally:
        js.write_text(t_j, encoding="utf-8")
        css.write_text(t_c, encoding="utf-8")
        _clear()
    message = str(exc.value)
    assert "foliplus-common.min.js" in message and "foliplus-common.min.css" in message
    assert "make dist" in message


def test_shared_header_raises_with_one_present(base_map: folium.Map):
    """A partially built dist/ is unusable — no silent half-render."""
    js = dist_dir / "foliplus-common.min.js"
    t_j = js.read_text(encoding="utf-8")
    _clear()
    try:
        js.unlink()
        with pytest.raises(MissingAssetsError, match="foliplus-common.min.js") as exc:
            _build_shared_header()
    finally:
        js.write_text(t_j, encoding="utf-8")
        _clear()
    assert "foliplus-common.min.css" not in str(exc.value), (
        "only the missing file is named"
    )


@pytest.mark.parametrize("artifact", ("min.js", "min.css"))
def test_component_render_raises(base_map: folium.Map, artifact: str):
    """A component missing either artifact fails at attach time, loudly."""
    p = dist_dir / f"foliplus-SearchControl.{artifact}"
    t = p.read_text(encoding="utf-8")
    _clear()
    try:
        p.unlink()
        with pytest.raises(MissingAssetsError, match="SearchControl"):
            SearchControl().add_to(base_map)
    finally:
        p.write_text(t, encoding="utf-8")
        _clear()


def test_shared_header_via_control(base_map: folium.Map):
    """A control on the map makes render() reach the shared header."""
    js = dist_dir / "foliplus-common.min.js"
    t_j = js.read_text(encoding="utf-8")
    _clear()
    try:
        js.unlink()
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        ExportControl().add_to(m)
        with pytest.raises(MissingAssetsError, match="common.min.js"):
            render(m)
    finally:
        js.write_text(t_j, encoding="utf-8")
        _clear()


def test_full_control_pipeline_renders(base_map: folium.Map):
    """Nothing missing → everything still renders."""
    m = folium.Map(location=[26.08, 119.30], zoom_start=12)
    ExportControl().add_to(m)
    SearchControl().add_to(m)
    html = render(m)
    assert "foliplus" in html


# ── Distribution packaging ──────────────────────────────────────────


def _member_names(path: str) -> list[str]:
    """Archive member paths, normalised to forward slashes."""
    if path.endswith(".whl"):
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
    else:
        with tarfile.open(path) as archive:
            names = archive.getnames()
    return [n.replace("\\", "/") for n in names]


def _dist_artifacts(path: str) -> set[str]:
    """`foliplus/dist/` members of a distribution archive, by basename.

    Wheels store the package at the archive root; an sdist nests it under
    `<distname>/`. Only files are counted — an sdist also carries the bare
    directory entry, which would otherwise be reported as a missing artifact.
    """
    out = set()
    for name in _member_names(path):
        parts = name.split("/")
        if "dist" not in parts:
            continue
        i = parts.index("dist")
        if len(parts) < i + 2 or parts[i - 1] != "foliplus":
            continue
        out.add(parts[-1])
    return out


def test_dist_directory_is_complete():
    """The source tree holds every artifact `findComponents` would emit."""
    missing = [n for n in EXPECTED if not (dist_dir / n).is_file()]
    assert not missing, f"dist/ is incomplete: {missing}"


def test_wheel_contains_all_artifacts():
    """A wheel without the bundles installs fine but renders no controls."""
    wheels = glob.glob(str(Path.cwd() / "dist" / "*.whl"))
    if not wheels:
        pytest.skip("no wheel built — run `make build-python` first")
    have = _dist_artifacts(wheels[0])
    missing = sorted(set(EXPECTED) - have)
    assert not missing, f"{wheels[0]} is missing: {missing}"


def test_sdist_contains_all_artifacts():
    """Same contract for the sdist — installing from source must not regress."""
    sdists = glob.glob(str(Path.cwd() / "dist" / "*.tar.gz"))
    if not sdists:
        pytest.skip("no sdist built — run `make build-python` first")
    have = _dist_artifacts(sdists[0])
    missing = sorted(set(EXPECTED) - have)
    assert not missing, f"{sdists[0]} is missing: {missing}"
