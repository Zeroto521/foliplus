"""Tests for `script/smoke-wheel.py`, the release CI's wheel verifier.

The script only runs against an installed wheel in the `release` job, but its
manifest check is pure enough to exercise here — and it is the one assertion
CI runs before publishing, so it has to be right.

Loading the script would import `foliplus` and `folium`, pulling in branca,
numpy, pandas and the rest of the stack. None of that is needed for the
manifest logic, so `smoke-wheel.py` resolves both via a
`_import_foliplus()` / `_import_folium()` seam instead of at module level,
and the test installs stubs through that seam rather than into
`sys.modules`. Touching `sys.modules` from a test module was tried and
abandoned: pytest imports every test module at collection time, so a stub
installed here shadows the real package for every other test in the
session — dozens of failures with `"foliplus" is not a package` — and no
teardown timing can undo it, because the other modules have already been
imported.
"""

from __future__ import annotations

import importlib.util
import json
import types
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent.parent
SCRIPT = REPO_ROOT / "script" / "smoke-wheel.py"

# `locate_controls()` inspects `dir(foliplus)`, so the stub must look like a
# real package surface. Sorted to match `sorted(dir(...))` inside the script.
_CONTROL_NAMES = ("ExportControl", "LayerControl", "ScaleControl")


def _make_stub() -> types.ModuleType:
    """A `foliplus` stand-in exposing only the classes under test."""
    stub = types.ModuleType("foliplus")
    for name in _CONTROL_NAMES:
        setattr(stub, name, type(name, (), {}))
    return stub


@pytest.fixture
def smoke():
    """`script/smoke-wheel.py`, loaded with `foliplus` and `folium` stubbed.

    Per-test rather than session-scoped: each test gets a fresh stub so a
    test that adds an attribute to the stub cannot leak it into the next.
    """
    stub = _make_stub()

    def _loader():
        return stub

    spec = importlib.util.spec_from_file_location("smoke_wheel", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    module._import_foliplus = _loader
    module._import_folium = lambda: types.ModuleType("folium")
    return module


def _write_dist(tmp_path: Path, artifacts: list[str], files: list[str]) -> Path:
    """A fake installed ``foliplus/dist/``: manifest plus the named files."""
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "artifacts.json").write_text(
        json.dumps({"artifacts": artifacts}), encoding="utf-8"
    )
    for name in files:
        (dist / name).write_text("x", encoding="utf-8")
    return dist


@pytest.fixture
def controls() -> list[str]:
    """Two components: the shared entry plus a real control."""
    return ["common", "ScaleControl"]


def _pairs(names: list[str]) -> list[str]:
    """Both the JS and CSS half for every component name."""
    return [f"foliplus-{n}.min.{e}" for n in names for e in ("js", "css")]


# ── check_manifest ──────────────────────────────────────────────────


def test_check_manifest_happy_path(tmp_path, controls, smoke):
    """Manifest and disk agree → the component names come back, order kept."""
    dist = _write_dist(tmp_path, controls, _pairs(controls))
    assert smoke.check_manifest(dist) == controls


def test_check_manifest_reports_missing_css_half(tmp_path, controls, smoke):
    """A component that lost its stylesheet is the exact defect this catches."""
    files = _pairs(controls)
    files.remove("foliplus-ScaleControl.min.css")
    dist = _write_dist(tmp_path, controls, files)
    with pytest.raises(smoke.SmokeFailure, match="foliplus-ScaleControl.min.css"):
        smoke.check_manifest(dist)


def test_check_manifest_reports_component_absent_from_disk(tmp_path, controls, smoke):
    """Manifest lists a component the build never emitted."""
    files = _pairs(controls)
    files.remove("foliplus-ScaleControl.min.js")
    files.remove("foliplus-ScaleControl.min.css")
    dist = _write_dist(tmp_path, controls, files)
    with pytest.raises(smoke.SmokeFailure, match="missing from dist"):
        smoke.check_manifest(dist)


def test_check_manifest_rejects_unexpected_file(tmp_path, controls, smoke):
    """A stray file in dist/ is not a valid artifact set."""
    dist = _write_dist(
        tmp_path, controls, _pairs(controls) + ["foliplus-Stale.min.js"]
    )
    with pytest.raises(smoke.SmokeFailure, match="unexpected files"):
        smoke.check_manifest(dist)


def test_check_manifest_allows_artifacts_json(tmp_path, controls, smoke):
    """The manifest itself lives in dist/ and is not an unexpected file."""
    dist = _write_dist(tmp_path, controls, _pairs(controls))
    assert smoke.check_manifest(dist) == controls


def test_check_manifest_missing_manifest_file(tmp_path, smoke):
    """No manifest at all — the build never ran. Fails loudly, not silently."""
    dist = tmp_path / "dist"
    dist.mkdir()
    with pytest.raises(OSError):
        smoke.check_manifest(dist)


def test_check_manifest_names_the_missing_file(tmp_path, controls, smoke):
    """The message names the artifact, so CI shows what to rebuild."""
    files = _pairs(controls)
    files.remove("foliplus-ScaleControl.min.css")
    dist = _write_dist(tmp_path, controls, files)
    with pytest.raises(smoke.SmokeFailure) as exc:
        smoke.check_manifest(dist)
    assert "missing from dist/" in str(exc.value)
    assert "foliplus-ScaleControl.min.css" in str(exc.value)


def test_check_manifest_missing_manifest_is_not_a_smoke_failure(tmp_path, smoke):
    """A missing manifest is an `OSError`, not a `SmokeFailure`: it means the
    wheel has no dist/ at all, which is a different diagnosis."""
    dist = tmp_path / "dist"
    dist.mkdir()
    with pytest.raises(Exception) as exc:
        smoke.check_manifest(dist)
    assert not isinstance(exc.value, smoke.SmokeFailure)


# ── locate_controls ─────────────────────────────────────────────────


def test_locate_controls_finds_all_stubbed_controls(smoke):
    """Every exported *Control class is discovered, by inspection."""
    assert [c.__name__ for c in smoke.locate_controls()] == list(_CONTROL_NAMES)


def test_locate_controls_excludes_basecontrol(smoke):
    """`BaseControl` is abstract and must never be counted as rendered."""
    assert "BaseControl" not in [c.__name__ for c in smoke.locate_controls()]


def test_locate_controls_only_types(smoke):
    """A non-class export is not rendered, even if it ends in Control."""
    smoke._import_foliplus().StaleControl = "not a class"
    assert all(isinstance(c, type) for c in smoke.locate_controls())


def test_locate_controls_is_sorted(smoke):
    """Discovery order is deterministic, so CI output is diffable."""
    names = [c.__name__ for c in smoke.locate_controls()]
    assert names == sorted(names)
