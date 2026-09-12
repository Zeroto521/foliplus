"""Asset-availability contract tests.

The historical failure mode: ``dist/`` is gitignored, so a release built
without the JS/CSS gate produced a wheel that installed, imported, and
rendered maps with no controls at all. Nothing raised — the missing files
just read as ``""``.

These tests pin the opposite: a missing artifact is always a loud failure,
at whichever point the pipeline first touches it (control construction, not
render — component JS/CSS are read in each control's ``__init__``), and a
real distribution really does carry the artifacts.
"""

from __future__ import annotations

import glob
import re
import subprocess
import tarfile
import types
import zipfile
from pathlib import Path

import folium
import pytest
from conftest import render

from foliplus import __path__
from foliplus.BaseControl import (
    MissingAssetsError,
    _build_component_template,
    _build_shared_header,
    _load_asset,
    dist_dir,
)
from foliplus.ExportControl import ExportControl
from foliplus.SearchControl import SearchControl

# Controls that read a `dist/` bundle.
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

# Basename of every artifact a wheel must carry. A control with no stylesheet
# is not a valid control — `script/build.mjs` asserts the same pair in
# `--verify`, and this list restates it so a wheel built without one half is
# caught here rather than at attach time.
EXPECTED = [
    *SHARED,
    *(f"foliplus-{c}.{ext}" for c in COMPONENTS for ext in ("min.js", "min.css")),
]

# The one file on disk whose absence the `--verify` gate must fail on.
REPO_ROOT = Path(__path__[0]).parent
BUILD_SCRIPT = REPO_ROOT / "script" / "build.mjs"


def _clear() -> None:
    _build_shared_header.cache_clear()
    _build_component_template.cache_clear()


# ── Missing-asset behaviour ─────────────────────────────────────────


def test_expected_artifacts_cover_both_sides():
    """`EXPECTED` is symmetric: every component contributes one JS and one CSS."""
    for c in COMPONENTS:
        assert f"foliplus-{c}.min.js" in EXPECTED
        assert f"foliplus-{c}.min.css" in EXPECTED
    assert len(EXPECTED) == 2 + 2 * len(COMPONENTS)
    assert len(set(EXPECTED)) == len(EXPECTED)


def test_load_asset_reads_a_present_file():
    """The success path: a present artifact is returned as text, untouched."""
    js = dist_dir / "foliplus-common.min.js"
    body = js.read_text(encoding="utf-8")
    assert _load_asset(js) == body


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


def test_component_template_missing_css(base_map: folium.Map):
    """A control with JS but no CSS fails at construction, not render.

    The pair contract: both halves are read before the template is compiled,
    so a JS-only control cannot slip through and raise later with a
    misleading message.
    """
    css = dist_dir / "foliplus-ScaleControl.min.css"
    t = css.read_text(encoding="utf-8")
    _clear()
    try:
        css.unlink()
        with pytest.raises(MissingAssetsError, match="foliplus-ScaleControl.min.css"):
            _build_component_template("ScaleControl")
    finally:
        css.write_text(t, encoding="utf-8")
        _clear()


# ── Template shape ──────────────────────────────────────────────────
# `_build_component_template` reads the payload from `dist/`, so the shape
# contract is asserted against a present artifact and read back out of the
# compiled template. Macro bodies come from `_template.module`, the way
# `branca.MacroElement` reads them — `Template.render()` alone only executes
# the top-level nodes and returns the newline between the two macros, which
# is why every assertion below goes through the module.


def _element_stub(map_name: str = "map", config: str = "{}"):
    """Just enough of a folium element for the template's `this` contract."""
    return types.SimpleNamespace(
        _parent=types.SimpleNamespace(get_name=lambda: map_name),
        _config_block=config,
    )


def _component_module(name: str = "ScaleControl"):
    """The compiled component template, macro bodies exposed for assertion."""
    _clear()
    return _build_component_template(name).module


def test_component_template_exposes_html_and_script_macros():
    """The template exposes the two macros branca renders, and nothing extra."""
    module = set(_component_module().__dict__)
    assert {"html", "script"} <= module
    assert "header" not in module


def test_component_template_keeps_js_out_of_the_head():
    """JS belongs to the body (`script`); the head (`html`) carries only CSS.

    The dev bundle is unminified, so it legitimately contains `(() => {`
    inside the payload — count it only at the wrapper boundary. The real
    invariant is that the head never carries executable JS.
    """
    module = _component_module()
    html = module.html(_element_stub(), {})
    script = module.script(_element_stub(), {})
    assert "<style>" in html and "</style>" in html
    # Wrapper is well formed: one opener at the front, one closer at the end.
    assert script.lstrip().startswith("(() => {")
    assert script.strip().endswith("})();")
    assert "const map = map;" in script
    assert "const CONF = {};" in script
    # The head is style-only: no executable code and no JS entry point.
    assert "const map" not in html
    assert "addTo(map)" not in html
    assert "(() => {" not in html


def test_component_template_binds_map_and_conf_from_the_instance():
    """`map` and `CONF` are resolved from the element, not hard-coded."""
    script = _component_module().script(_element_stub("_map_1", "{}"), {})
    assert "const map = _map_1;" in script
    assert "const CONF = {};" in script


def test_shared_header_structure():
    """The shared bundle is one <style> and one <script>, in that order."""
    header = _build_shared_header()
    assert header.count("<style>") == 1 and header.count("</style>") == 1
    assert header.count("<script>") == 1 and header.count("</script>") == 1
    assert header.index("<style>") < header.index("<script>")
    # The runtime must be initialisable on its own before any control runs.
    assert "window.foliplus = window.foliplus || {};" in header
    # The locale tables ride along in the same bundle.
    assert "window.foliplus._TABLES" in header


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


def test_verify_gate_passes_on_a_complete_tree():
    """The gate's success arm: a full dist/ exits 0, or `make build-python` is dead."""
    if subprocess.run(["node", "--version"], capture_output=True).returncode != 0:
        pytest.skip("node not available — the build gate cannot be exercised")
    result = _run_verify()
    assert result.returncode == 0, (
        f"--verify must pass on a complete dist/, got {result.returncode}\n"
        f"stderr: {result.stderr}"
    )


def test_verify_gate_fails_on_a_missing_artifact():
    """`npm run build:verify` is what gates `uv build` — prove it exits 1."""
    assert BUILD_SCRIPT.is_file(), f"{BUILD_SCRIPT} not found"
    if subprocess.run(["node", "--version"], capture_output=True).returncode != 0:
        pytest.skip("node not available — the build gate cannot be exercised")

    js = dist_dir / "foliplus-common.min.js"
    body = js.read_text(encoding="utf-8")
    try:
        js.unlink()
        result = _run_verify()
        assert result.returncode == 1, (
            f"--verify must fail on a missing artifact, got {result.returncode}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "foliplus-common.min.js" in (result.stderr + result.stdout)
    finally:
        js.write_text(body, encoding="utf-8")


def test_verify_gate_fails_when_a_control_has_no_stylesheet():
    """A control with JS but no stylesheet must not slip through the gate.

    Regression for the gate being looser than the reader: ``verifyDist`` used
    to expect the stylesheet only when the *source* CSS existed (``if (css)``),
    while ``_build_component_template`` unconditionally reads both halves. So a
    control losing its stylesheet passed the gate and then raised
    ``MissingAssetsError`` at attach time.

    The trigger is a missing *source* file, not a missing ``dist/`` artifact:
    deleting the artifact already fails the base gate (the CSS artifact is still
    expected), and the build never cleans ``dist/``, so a stale stylesheet would
    mask the gap until a clean checkout. Hence both files are removed here.
    """
    assert BUILD_SCRIPT.is_file(), f"{BUILD_SCRIPT} not found"
    if subprocess.run(["node", "--version"], capture_output=True).returncode != 0:
        pytest.skip("node not available — the build gate cannot be exercised")

    src_css = REPO_ROOT / "foliplus" / "css" / "ScaleControl.css"
    dist_css = dist_dir / "foliplus-ScaleControl.min.css"
    for artifact in (src_css, dist_css):
        assert artifact.is_file(), f"{artifact.name} not found"

    src_body, dist_body = src_css.read_text(encoding="utf-8"), dist_css.read_text(
        encoding="utf-8"
    )
    try:
        src_css.unlink()
        dist_css.unlink()
        result = _run_verify()
        assert result.returncode == 1, (
            f"--verify must fail when a control ships no stylesheet, "
            f"got {result.returncode}\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )
        assert "foliplus-ScaleControl.min.css" in (result.stderr + result.stdout)
    finally:
        src_css.write_text(src_body, encoding="utf-8")
        dist_css.write_text(dist_body, encoding="utf-8")


def _run_verify() -> subprocess.CompletedProcess[str]:
    """Run `node script/build.mjs --verify` from the repo root."""
    return subprocess.run(
        ["node", str(BUILD_SCRIPT), "--verify"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


def _check_archives(pattern: str) -> int:
    """Assert every archive matching `pattern` carries every artifact.

    Returns the number checked, so a caller can skip only when nothing was
    built. `pytest.skip` raises, so an empty glob inside the loop would
    abort the other archive kind — hence the count is decided by the caller.
    """
    archives = glob.glob(str(Path.cwd() / "dist" / pattern))
    for archive in sorted(archives):
        have = _dist_artifacts(archive)
        missing = sorted(set(EXPECTED) - have)
        assert not missing, f"{archive} is missing: {missing}"
    return len(archives)


def test_distributions_contain_all_artifacts():
    """Every distribution archive in ``dist/`` carries every artifact.

    Assert over all of them rather than the first match: ``make dist``
    accumulates archives across commits, so ``glob(...)[0]`` could validate a
    stale artifact from an earlier build and still pass — an older wheel has
    the same filenames, only older ``BaseControl`` inside.
    """
    checked = _check_archives("*.whl")
    checked += _check_archives("*.tar.gz")
    if not checked:
        pytest.skip("no distributions built — run `make build-python` first")


def _packaged_version(path: str) -> str | None:
    """The ``foliplus._version`` string baked into one archive.

    vcs-versioning writes ``__version__ = version = '0.3.2.dev161+g<sha>``
    at build time, so this pin cannot drift from the commit that produced the
    archive. Read as text and parsed — never import, since the module lives
    inside a zip.
    """
    for name in _member_names(path):
        if name.endswith("foliplus/_version.py"):
            for line in _read_member(path, name).splitlines():
                match = re.search(r"__version__\s*=\s*.*?['\"]([^'\"]+)['\"]", line)
                if match:
                    return match.group(1)
    return None


def _read_member(path: str, name: str) -> str:
    if path.endswith(".whl"):
        with zipfile.ZipFile(path) as archive:
            return archive.read(name).decode("utf-8")
    with tarfile.open(path) as archive:
        return archive.extractfile(name).read().decode("utf-8")


def test_newest_distribution_matches_the_build():
    """The newest archive was built from the commit checked out here.

    The artifact check above cannot catch a stale archive: an older wheel
    carries the same filenames with older ``BaseControl`` inside. The only
    signal is the commit pin vcs-versioning bakes into ``_version.py``
    (``...+g<sha>``). Compare against the live checkout rather than assuming
    a version string shape — a tag build has a differently shaped version
    and is still a legitimate ``uv build`` output.
    """
    wheels = sorted(glob.glob(str(Path.cwd() / "dist" / "*.whl")))
    if not wheels:
        pytest.skip("no wheel built — run `make build-python` first")
    newest = max(wheels, key=Path.getmtime)
    version = _packaged_version(newest)
    assert version is not None, f"{newest} has no foliplus/_version.py"

    commit = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True
    ).strip()
    pin = re.search(r"\+g([0-9a-f]+)", version)
    assert pin is not None, (
        f"{newest} version {version!r} has no commit pin — "
        "it did not come from `uv build`"
    )
    assert pin.group(1).startswith(commit), (
        f"{newest} was built from {pin.group(1)} but HEAD is {commit} — "
        "the wheel is stale, rerun `make build-python`"
    )
