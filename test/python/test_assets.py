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
import importlib.util
import subprocess
import sys
import tarfile
import types
import zipfile
from pathlib import Path

import folium
import pytest
from conftest import render, render_control

from foliplus.BaseControl import (
    MissingAssetsError,
    _build_component_template,
    _build_shared_header,
    _load_asset,
    dist_dir,
    expected_artifacts,
)
from foliplus.ExportControl import ExportControl
from foliplus.SearchControl import SearchControl

# Single source for the artifact list: `script/build.mjs` writes
# `dist/artifacts.json` on every real build, and both this file and
# `test/js/script/build.test.ts` read it. A new control is therefore
# asserted in both stacks without either suite re-deriving the names.
EXPECTED = expected_artifacts()

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "script" / "smoke-wheel.py"


def _smoke_module() -> types.ModuleType:
    """`script/smoke-wheel.py`, loaded without importing the release stack.

    This file already imports `BaseControl`, so the cross-check belongs here
    rather than in `test_smoke_wheel.py`, which deliberately avoids it to stay
    lightweight enough to run without branca, numpy or pandas.
    """
    spec = importlib.util.spec_from_file_location("smoke_wheel_assert", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


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


def test_shared_header_names_both_files():
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


def test_shared_header_raises_with_one_present():
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
def test_component_render_raises(artifact: str):
    """A component missing either artifact fails at attach time, loudly."""
    p = dist_dir / f"foliplus-SearchControl.{artifact}"
    t = p.read_text(encoding="utf-8")
    _clear()
    try:
        p.unlink()
        with pytest.raises(MissingAssetsError, match="SearchControl"):
            render_control(SearchControl())
    finally:
        p.write_text(t, encoding="utf-8")
        _clear()


def test_shared_header_via_control():
    """A control on the map makes render() reach the shared header."""
    js = dist_dir / "foliplus-common.min.js"
    t_j = js.read_text(encoding="utf-8")
    _clear()
    try:
        js.unlink()
        with pytest.raises(MissingAssetsError, match="common.min.js"):
            render_control(ExportControl())
    finally:
        js.write_text(t_j, encoding="utf-8")
        _clear()


def test_full_control_pipeline_renders():
    """Nothing missing → everything still renders."""
    assert "foliplus" in render_control(ExportControl())
    assert "foliplus" in render_control(SearchControl())


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
    """The source tree holds every artifact the build recorded emitting."""
    missing = [n for n in EXPECTED if not (dist_dir / n).is_file()]
    assert not missing, f"dist/ is incomplete: {missing}"


def test_manifest_has_both_halves():
    """Every component name yields a JS and a CSS artifact, including common."""
    assert len(EXPECTED) == 2 * len(set(n.rsplit(".min.", 1)[0] for n in EXPECTED))
    assert any(n.startswith("foliplus-common.min.") for n in EXPECTED)


def test_smoke_script_shares_the_naming_scheme():
    """The release CI verifier must name files the way `BaseControl` does.

    It re-implements the scheme, because it cannot import the package it is
    verifying. If it drifted, the gate would check filenames the render never
    opens — a manifest that passes while the bundles stay empty.
    """
    from foliplus.BaseControl import control_assets

    smoke = _smoke_module()
    for name in set(
        n.rsplit(".min.", 1)[0].removeprefix("foliplus-") for n in EXPECTED
    ):
        js, css = control_assets(name)
        assert js.name == smoke.artifact_name(name, "js")
        assert css.name == smoke.artifact_name(name, "css")


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
