"""Tests for `script/smoke-wheel.py`, the release CI's wheel verifier.

The script only runs against an installed wheel in the `release` job, but its
manifest check is pure enough to exercise here — and it is the one assertion
CI runs before publishing, so it has to be right.

`check_manifest()` and `locate_controls()` are pure: they take the `foliplus`
module as a parameter, so the test passes a stub and never imports branca,
numpy, pandas or the rest of the stack the script pulls in at run time.
That parameter matters, not just the stub — loading the script through
`sys.modules` instead was tried and abandoned: pytest imports every test
module at collection time, so a stub installed there shadows the real
package for every other test in the session, which reads as dozens of
failures with `"foliplus" is not a package`, and no teardown timing undoes
it because the other modules have already been imported.
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


def _make_stub(package_dir: Path | None = None) -> types.ModuleType:
    """A `foliplus` stand-in exposing only the classes under test.

    `package_dir` pins `__file__`, which `assert_not_source_checkout()`
    reads to decide whether the import came from a checkout or an install.
    """
    stub = types.ModuleType("foliplus")
    if package_dir is not None:
        stub.__file__ = str(package_dir / "__init__.py")
    for name in _CONTROL_NAMES:
        setattr(stub, name, type(name, (), {}))
    return stub


@pytest.fixture
def smoke():
    """`script/smoke-wheel.py`, loaded without importing folium or foliplus."""
    spec = importlib.util.spec_from_file_location("smoke_wheel", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def package() -> types.ModuleType:
    """A fresh stub per test, so a test that adds an attribute cannot leak."""
    return _make_stub()


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
    dist = _write_dist(tmp_path, controls, _pairs(controls) + ["foliplus-Stale.min.js"])
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


def test_locate_controls_finds_all_stubbed_controls(smoke, package):
    """Every exported *Control class is discovered, by inspection."""
    assert [c.__name__ for c in smoke.locate_controls(package)] == list(_CONTROL_NAMES)


def test_locate_controls_excludes_basecontrol(smoke, package):
    """`BaseControl` is abstract and must never be counted as rendered."""
    assert "BaseControl" not in [c.__name__ for c in smoke.locate_controls(package)]


def test_locate_controls_only_types(smoke, package):
    """A non-class export is not rendered, even if it ends in Control."""
    package.StaleControl = "not a class"
    assert all(isinstance(c, type) for c in smoke.locate_controls(package))


def test_locate_controls_is_sorted(smoke, package):
    """Discovery order is deterministic, so CI output is diffable."""
    names = [c.__name__ for c in smoke.locate_controls(package)]
    assert names == sorted(names)


# ── render_control ─────────────────────────────────────────────────


def _render_stub(html: str) -> types.ModuleType:
    """A `folium` stub that renders one fixed document regardless of control."""
    class Map:
        def get_root(self) -> Map:
            return self

    Map.__init__ = lambda self, location: None
    Map.render = lambda self: html
    module = types.ModuleType("folium")
    module.Map = Map
    return module


def _bundle(control: str, externalise: bool = True) -> str:
    """The shape a real bundle has: an esbuild banner, then the runtime ref."""
    head = f"/*! foliplus@v0.1.0 · {control} */\n"
    body = "var c = foliplus.BaseControl;" if externalise else "var x = 1;"
    return head + body


def _cls(name: str) -> type:
    """A control class carrying the surface `render_control()` touches."""
    return type(name, (), {"add_to": lambda self, m: None})


def test_render_control_passes_on_a_real_bundle(tmp_path, smoke):
    """Banner and externalisation present in both bundle and HTML → passes."""
    folium_stub = _render_stub("/*! foliplus@v0.1.0 · ScaleControl */\nfoliplus.BaseControl;")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text(_bundle("ScaleControl"), encoding="utf-8")
    smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


def test_render_control_rejects_a_bundle_without_the_component(tmp_path, smoke):
    """The sharp form of the defect: the file exists, but is not the bundle.

    `_load_asset` sees a present file, the render emits a perfectly valid
    document, and the gate would pass unless the bundle's own content is
    required to be in the HTML. A banner-only file carries the shared
    `foliplus@` marker, so only the component-specific marker catches it.
    """
    folium_stub = _render_stub("/*! foliplus@v0.1.0 */\nfoliplus.BaseControl;")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text("/*! foliplus@v0.1.0 */\n", encoding="utf-8")
    with pytest.raises(AssertionError, match="bundle holds no"):
        smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


def test_render_control_rejects_a_bundle_without_the_runtime(tmp_path, smoke):
    """A bundle that names the component but never externalises to the shared
    runtime cannot drive it — dead code, and the render proves it."""
    folium_stub = _render_stub("/*! foliplus@v0.1.0 · ScaleControl */\nfoliplus.BaseControl;")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text(_bundle("ScaleControl", externalise=False), encoding="utf-8")
    with pytest.raises(AssertionError, match="bundle holds no"):
        smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


def test_render_control_rejects_html_without_the_component(tmp_path, smoke):
    """The bundle is right but the render lost it: the page ships a dead control."""
    folium_stub = _render_stub("/*! foliplus@v0.1.0 */\nfoliplus.BaseControl;")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text(_bundle("ScaleControl"), encoding="utf-8")
    with pytest.raises(AssertionError, match="missing from the rendered page"):
        smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


def test_render_control_rejects_html_without_the_runtime(tmp_path, smoke):
    """The component banner is in the document but the runtime reference is not."""
    folium_stub = _render_stub("/*! foliplus@v0.1.0 · ScaleControl */\n")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text(_bundle("ScaleControl"), encoding="utf-8")
    with pytest.raises(AssertionError, match="missing from the rendered page"):
        smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


def test_render_control_rejects_html_without_any_banner(tmp_path, smoke):
    """No `foliplus@` anywhere: the shared runtime never reached the document."""
    folium_stub = _render_stub("no assets at all")
    bundle = tmp_path / "foliplus-ScaleControl.min.js"
    bundle.write_text(_bundle("ScaleControl"), encoding="utf-8")
    with pytest.raises(AssertionError, match="shared bundle banner absent"):
        smoke.render_control(folium_stub, _cls("ScaleControl"), bundle)


# ── assert_not_source_checkout ──────────────────────────────────────


def test_assert_not_source_checkout_accepts_an_install(tmp_path, smoke):
    """A package that lives next to no repo files passes silently."""
    pkg = tmp_path / "foliplus"
    pkg.mkdir()
    smoke.assert_not_source_checkout(_make_stub(pkg))


def test_assert_not_source_checkout_rejects_a_checkout(tmp_path, smoke):
    """`pyproject.toml` beside the package means the source tree won."""
    pkg = tmp_path / "foliplus"
    pkg.mkdir()
    (tmp_path / "pyproject.toml").write_text("", encoding="utf-8")
    with pytest.raises(smoke.SmokeFailure) as exc:
        smoke.assert_not_source_checkout(_make_stub(pkg))
    message = str(exc.value)
    assert "source checkout" in message
    assert "pyproject.toml" in message


def test_assert_not_source_checkout_marks_matter_independently(tmp_path, smoke):
    """`test/` alone is enough — a CI layout without pyproject is still a repo."""
    pkg = tmp_path / "foliplus"
    pkg.mkdir()
    (tmp_path / "test").mkdir()
    with pytest.raises(smoke.SmokeFailure) as exc:
        smoke.assert_not_source_checkout(_make_stub(pkg))
    assert "test" in str(exc.value)


def test_assert_not_source_checkout_rejects_editable_install(tmp_path, smoke):
    """An editable checkout carries both markers and must be refused, not
    silently certified by whatever `dist/` the working copy happens to hold."""
    pkg = tmp_path / "foliplus"
    pkg.mkdir()
    (tmp_path / "pyproject.toml").write_text("", encoding="utf-8")
    (tmp_path / "test").mkdir()
    with pytest.raises(smoke.SmokeFailure):
        smoke.assert_not_source_checkout(_make_stub(pkg))
