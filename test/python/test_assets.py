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
import re
import subprocess
import sys
import tarfile
import types
import zipfile
from pathlib import Path

import folium
import pytest
from conftest import read_css, render, render_control

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


def test_dist_bundle_applies_svg_compression():
    """The dist bundles carry SVGO-compressed SVG strings (polyline → path).

    The source-transform onLoad guard once appended a hardcoded ``"/"`` to a
    ``path.resolve()``-based source dir, so the prefix never matched a
    backslash path on Windows and every source transform was silently
    skipped — bundles built there shipped the raw ``<polyline>`` chevron
    instead of a ``<path>``, tripping the fold-button browser test. Pinning
    the compressed form here guards the guard on every platform.
    """
    js = (dist_dir / "foliplus-LayerControl.min.js").read_text(encoding="utf-8")
    assert "<polyline" not in js, (
        "the FOLD chevron must be SVGO-compressed to a <path> — a raw "
        "polyline means the source-transform plugin was skipped on this "
        "platform (Windows path-separator guard)"
    )


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


# ── Split stylesheet structure ──────────────────────────────────────
# LayerControl.css is split into css/LayerControl/{index,focus,rows,menu,
# attrs,controls,map-state,rename,style,annotation}.css by responsibility.
# These tests guard the split: modules exist, the entry imports them in
# order, and each module owns the rules its name claims — a token moving to
# the wrong module now fails precisely instead of silently surviving the
# merged entry.

LAYER_CSS_DIR = REPO_ROOT / "foliplus" / "css" / "LayerControl"

# Module name → a token only it owns (proves both existence and ownership).
# Tokens are chosen to appear in exactly one module across the whole split.
LAYER_MODULE_TOKENS = {
    "focus.css": ".foliplus-focus-rect",
    "rows.css": ".foliplus-layer-dragging",
    "menu.css": ".foliplus-layer-more-menu li",
    "attrs.css": ".foliplus-layer-attrs-panel",
    "controls.css": 'input[type="checkbox"]',
    "map-state.css": "@keyframes foliplus-drag-pulse",
    "rename.css": ".foliplus-layer-rename-input",
    "style.css": ".foliplus-layer-style-panel",
    "annotation.css": ".foliplus-annotation-label-text",
}

# Exact import order expected in index.css — mirrors the single-file cascade
# order (a flattened rule sequence that must not be reordered).
LAYER_IMPORT_ORDER = [
    "focus.css",
    "rows.css",
    "menu.css",
    "attrs.css",
    "controls.css",
    "map-state.css",
    "rename.css",
    "style.css",
    "annotation.css",
]


class TestLayerControlCssSplit:
    """The split stylesheet: modules exist, are imported in order, and own
    their claimed rules."""

    def test_index_imports_all_modules_in_order(self):
        # Read the entry verbatim (read_css would expand the imports away).
        index = (LAYER_CSS_DIR / "index.css").read_text(encoding="utf-8")
        imports = re.findall(r'@import\s+"\./([^"]+\.css)";', index)
        assert imports == LAYER_IMPORT_ORDER

    def test_every_module_exists_and_is_nonempty(self):
        for name in LAYER_IMPORT_ORDER:
            path = LAYER_CSS_DIR / name
            assert path.is_file(), f"split module missing: {name}"
            content = path.read_text(encoding="utf-8")
            assert content.strip(), f"split module is empty: {name}"

    def test_each_module_owns_its_token(self):
        for name, token in LAYER_MODULE_TOKENS.items():
            content = read_css(str(LAYER_CSS_DIR / name))
            assert token in content, f"{name} should own {token!r}"

    def test_merged_entry_exposes_every_module_token(self):
        # Python bridge tests read the entry via read_css() and assert design
        # tokens against the *merged* stylesheet (mirroring the bundle).
        # Verify the @import expansion surfaces every module's rules.
        merged = read_css(str(LAYER_CSS_DIR / "index.css"))
        for token in LAYER_MODULE_TOKENS.values():
            assert token in merged, f"merged entry lost module token {token!r}"

    def test_merged_entry_has_no_duplicate_module_tokens(self):
        # A token must live in exactly one module: the module that owns it.
        # If it shows up elsewhere too, the rule was mis-split rather than
        # shared — a duplicate means the two modules fight over the rule.
        for owner, token in LAYER_MODULE_TOKENS.items():
            for other in LAYER_IMPORT_ORDER:
                if other == owner:
                    continue
                other_css = read_css(str(LAYER_CSS_DIR / other))
                assert token not in other_css, (
                    f"{token!r} owned by {owner} also appears in {other}"
                )

    def test_only_the_entry_imports(self):
        # Component modules are leaves: only index.css may carry @import.
        # This keeps read_css (which resolves an import chain) and the build's
        # expandEntry (which strips a module's own imports) in agreement — if a
        # module ever imports another, the two would disagree on the bundle.
        for name in LAYER_IMPORT_ORDER:
            content = (LAYER_CSS_DIR / name).read_text(encoding="utf-8")
            imports = [
                line
                for line in content.splitlines()
                if line.strip().startswith("@import")
            ]
            assert not imports, f"{name} must be a leaf, but imports: {imports}"

    def test_read_css_expands_imports_recursively(self):
        # read_css() must behave like the esbuild bundle: an import statement
        # is replaced by the imported module's content, so the merged entry
        # carries every module's rules inline, in import order.
        merged = read_css(str(LAYER_CSS_DIR / "index.css"))
        # No `@import` *statement* may survive the expansion (the entry's own
        # banner comment may still mention the word).
        import_statements = [
            line for line in merged.splitlines() if line.strip().startswith("@import")
        ]
        assert not import_statements, (
            "read_css left @import statements unexpanded: "
            + "; ".join(import_statements)
        )
        # Expectation: entry lines with imports replaced by the module lines
        # (read_css normalises every file to its splitlines(), so the tail
        # newline of each module file is consumed too).
        entry = (LAYER_CSS_DIR / "index.css").read_text(encoding="utf-8").splitlines()
        expected_parts = []
        for line in entry:
            m = re.match(r'^\s*@import\s+"\./([^"]+\.css)";', line)
            if m:
                expected_parts += (
                    (LAYER_CSS_DIR / m.group(1))
                    .read_text(encoding="utf-8")
                    .splitlines()
                )
            else:
                expected_parts.append(line)
        assert merged == "\n".join(expected_parts), (
            "read_css expansion != entry with imports inlined in order"
        )
        # A module's own @import (common css style) is also expanded.
        common_input = str(REPO_ROOT / "foliplus" / "css" / "common" / "input.css")
        if Path(common_input).is_file():
            expanded = read_css(common_input)
            assert "@import" not in expanded
