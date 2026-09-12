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
    _compile_component_template,
    _load_asset,
    control_assets,
    dist_dir,
)
from foliplus.ExportControl import ExportControl
from foliplus.SearchControl import SearchControl

# Controls that read a `dist/` bundle. `GuideControl` is excluded: it ships its
# own inline template, so it has no artifact to expect and nothing for the
# packaging tests below to check.
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

# Basename of every artifact a wheel must carry. Derived from the same pair
# the reader uses (`control_assets`) rather than restating the filenames —
# a control with no stylesheet is not a valid control.
EXPECTED = [*SHARED, *(f.name for c in COMPONENTS for f in control_assets(c))]

# The one file on disk whose absence the `--verify` gate must fail on.
REPO_ROOT = Path(__path__[0]).parent
BUILD_SCRIPT = REPO_ROOT / "script" / "build.mjs"


def _clear() -> None:
    _build_shared_header.cache_clear()
    _build_component_template.cache_clear()


# ── Missing-asset behaviour ─────────────────────────────────────────


def test_control_assets_names_the_js_and_css_pair():
    """The contract a control ships both artifacts, in the reader's own words."""
    js, css = control_assets("ScaleControl")
    assert js.name == "foliplus-ScaleControl.min.js"
    assert css.name == "foliplus-ScaleControl.min.css"
    assert js.parent == css.parent == dist_dir


def test_expected_artifacts_come_from_the_reader():
    """`EXPECTED` is derived from `control_assets`, so it cannot drift from it."""
    assert EXPECTED == [
        *SHARED,
        *(f.name for c in COMPONENTS for f in control_assets(c)),
    ]
    assert len(EXPECTED) == 2 + 2 * len(COMPONENTS)


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


def test_error_names_component_artifacts_repo_relative():
    """The same repo-relative form holds for a component bundle, not just shared."""
    err = MissingAssetsError(list(control_assets("MeasureControl")))
    text = str(err).replace("\\", "/")
    assert "foliplus/dist/foliplus-MeasureControl.min.js" in text
    assert "foliplus/dist/foliplus-MeasureControl.min.css" in text


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


# ── Template shape ──────────────────────────────────────────────────
# `_compile_component_template` takes the JS/CSS as strings, so the
# template's contract is assertable here without touching `dist/`. Macro
# bodies come from `_template.module`, the way `branca.MacroElement` reads
# them — `Template.render()` alone only executes the top-level nodes and
# returns the newline between the two macros, which is why every
# assertion below goes through the module.
#
# JS/CSS are payload, not template source — a bare `{{` makes `Template()`
# raise, so payloads below carry balanced braces only.


def test_compile_template_exposes_html_and_script_macros():
    """The template exposes the two macros branca renders, and nothing extra."""
    tpl = _compile_component_template("ScaleControl", "/*JS*/", "/*CSS*/")
    module = set(tpl.module.__dict__)
    assert {"html", "script"} <= module
    assert "header" not in module


def test_compile_template_emits_both_assets_in_the_right_macro():
    """CSS belongs to the head (`html`), JS to the body (`script`)."""
    module = _compile_component_template("ScaleControl", "/*JS*/", "/*CSS*/").module
    html = module.html(_element_stub(), {})
    script = module.script(_element_stub(), {})
    assert "<style>" in html and "</style>" in html
    assert "/*CSS*/" in html
    assert "/*JS*/" not in html
    assert "(() => {" in script and "})();" in script
    assert "/*JS*/" in script
    assert "/*CSS*/" not in script


def test_compile_template_wraps_js_in_an_iife():
    """The script runs once, with `map` and `CONF` as free variables."""
    script = _compile_component_template("ScaleControl", "//body", "").module.script(
        _element_stub(), {}
    )
    # The IIFE is a wrapper: the component body sits inside it.
    assert script.index("(() => {") < script.index("//body") < script.index("})();")


def test_compile_template_binds_map_and_conf_from_the_instance():
    """`map` and `CONF` are resolved from the element, not hard-coded."""
    script = _compile_component_template("ScaleControl", "//body", "").module.script(
        _element_stub(map_name="_map_1", config="{}"), {}
    )
    assert "const map = _map_1;" in script
    assert "const CONF = {};" in script


def test_compile_template_payload_is_not_parsed_as_jinja():
    """A `{{` / `{%` in the payload makes `Template()` raise — payload is data."""
    with pytest.raises(Exception, match="end of print statement"):
        _compile_component_template("ScaleControl", "var x = {{ }};", "")
    with pytest.raises(Exception, match="Missing end of raw directive"):
        _compile_component_template("ScaleControl", "", "{% raw %}")
    # Balanced but non-meta braces are payload and must survive untouched.
    module = _compile_component_template(
        "ScaleControl", js="var x = { a: 1 };", css=".a { color: red; }"
    ).module
    assert "var x = { a: 1 };" in module.script(_element_stub(), {})
    assert ".a { color: red; }" in module.html(_element_stub(), {})


def _element_stub(map_name: str = "map", config: str = "{}"):
    """Just enough of a folium element for the template's `this` contract."""
    return types.SimpleNamespace(
        _parent=types.SimpleNamespace(get_name=lambda: map_name),
        _config_block=config,
    )


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


def test_components_all_ship_both_artifacts():
    """Every `COMPONENTS` entry resolves to a real pair on disk.

    A control that ships JS without CSS (or vice versa) would pass the
    build gate and then raise `MissingAssetsError` at attach time — this
    is the asymmetry the `control_assets` pair exists to prevent.
    """
    for name in COMPONENTS:
        js, css = control_assets(name)
        for artifact in (js, css):
            assert artifact.is_file(), f"{artifact.name} missing from dist/"


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


def _run_verify() -> subprocess.CompletedProcess[str]:
    """Run `node script/build.mjs --verify` from the repo root."""
    return subprocess.run(
        ["node", str(BUILD_SCRIPT), "--verify"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
    )


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
