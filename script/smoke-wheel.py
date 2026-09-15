#!/usr/bin/env python3
"""Render every exported control against a freshly installed foliplus.

`foliplus/dist` is not under version control, so a bad build yields a
wheel that installs, imports, and renders maps with no controls at all.
Nothing raises. This script is the check for that failure mode.

Controls are discovered from `dir(foliplus)` and classified by inspection
rather than listed by name. A name allow-list is how a stale reference to
a control that was never merged on this branch got past the gate in the
first place — anyone adding a control has to remember to edit two files.
Inspection has no such second file.

The package under test must not be shadowed by a source checkout: point
`PYTHONPATH` at an install target. Any `sys.path` entry that holds a
`foliplus/` directory beats `PYTHONPATH` when it comes first — a stray
probe script left in the repo root does exactly that, since `sys.path[0]`
is the script's own directory. A good source tree would then certify a
broken wheel, because the manifest check reads the install while the
render reads the checkout. `assert_not_source_checkout()` refuses to run
in that case rather than silently passing.

Usage: python script/smoke-wheel.py
Raises on the first failure (`SmokeFailure` for a bad artifact set,
`AssertionError` for a render gap); exits non-zero only through that
exception, so a traceback in CI means a broken wheel.
"""

from __future__ import annotations

import importlib.metadata
import json
import sys
from pathlib import Path
from types import ModuleType


class SmokeFailure(AssertionError):
    """A packaged wheel cannot render.

    Named rather than a bare `AssertionError` so a CI log can tell a broken
    wheel from a test bug without reading the traceback.
    """


def locate_controls(foliplus: ModuleType) -> list[type]:
    """The exported `*Control` classes, excluding the `BaseControl` abstract."""
    return [
        getattr(foliplus, n)
        for n in sorted(dir(foliplus))
        if n.endswith("Control")
        and n != "BaseControl"
        and isinstance(getattr(foliplus, n), type)
    ]


def check_manifest(dist_path: Path) -> list[str]:
    """Every artifact the build wrote is present, and nothing extra is there.

    `_load_asset` raises `MissingAssetsError` if a bundle is absent, but only
    for a control that actually gets rendered — a component that lost its
    stylesheet in the wheel would go unnoticed here without this. The
    manifest is what `script/build.mjs` wrote, so comparing both sides
    catches a component dropped on either end.
    """
    manifest = json.loads((dist_path / "artifacts.json").read_text(encoding="utf-8"))
    listed = manifest["artifacts"]
    expected = {
        f"foliplus-{name}.min.{ext}" for name in listed for ext in ("js", "css")
    }
    on_disk = {p.name for p in dist_path.iterdir() if p.is_file()}
    if expected - on_disk:
        raise SmokeFailure(f"missing from dist/: {sorted(expected - on_disk)}")
    # artifacts.json is written by the build alongside the bundles, not part
    # of the expected set — allow it, reject anything else.
    if on_disk - expected - {"artifacts.json"}:
        raise SmokeFailure(
            f"unexpected files in dist/: {sorted(on_disk - expected - {'artifacts.json'})}"
        )
    return listed


def assert_not_source_checkout(foliplus: ModuleType) -> None:
    """Refuse to run if the import resolved to a source tree, not an install.

    A checkout is recognisable by the files a wheel never carries: `pyproject.toml`
    and `test/` beside the package. Any one of them means the render is
    exercising the working copy, so a good source tree would certify a
    broken wheel.
    """

    pkg_dir = Path(foliplus.__file__).resolve().parent
    repo_root = pkg_dir.parent
    markers = [repo_root / "pyproject.toml", repo_root / "test"]
    found = [str(m.relative_to(repo_root)) for m in markers if m.is_dir() or m.is_file()]
    if found:
        raise SmokeFailure(
            f"imported foliplus from a source checkout at {pkg_dir} "
            f"({', '.join(found)} present) — not from an installed wheel; "
            "a good source tree would mask a broken wheel. "
            "Install into an empty dir and run with PYTHONPATH pointed at it."
        )


def render_control(folium: ModuleType, cls: type, bundle_path: Path) -> None:
    """Render one control onto a blank map, asserting the bundle really landed.

    `check_manifest()` proves the files exist; this proves they are not empty
    shells. A truncated bundle is the sharper form of the defect this script
    exists for: `_load_asset` sees a file, the render produces a perfectly
    valid 160KB document, and the page ships with a dead control. So the
    bundle's own content is re-read and required to be present in the HTML.
    """
    name = cls.__name__
    m = folium.Map(location=[40.4, -3.7])
    cls().add_to(m)
    # `add_to` can swap the map's root for a Figure, so render the root.
    html = m.get_root().render()

    # The bundle is inlined, so its filename never appears in the document —
    # but the esbuild banner is the bundle's first line and survives the
    # copy, so it is the cheapest content fingerprint. `foliplus.` is what a
    # component bundle externalises to the shared runtime; without it the
    # bundle is empty of anything that could drive the control.
    js = bundle_path.read_text(encoding="utf-8")
    assert "foliplus@" in html, f"{name}: shared bundle banner absent from <head>"
    for marker in (f"· {name}", "foliplus.BaseControl"):
        assert marker in js, f"{name}: bundle holds no {marker!r}"
        assert marker in html, f"{name}: {marker!r} missing from the rendered page"


def main() -> None:
    # The script's own directory is `sys.path[0]`, so a stray `script/foliplus.py`
    # or `script/folium.py` would be imported instead of the installed package —
    # a scratch file silently replacing the thing under test. Drop the entry
    # before importing; nothing else in this script needs it.
    self_dir = str(Path(__file__).resolve().parent)
    sys.path = [p for p in sys.path if str(Path(p).resolve()) != self_dir]

    # Imported here rather than at module level: `test_smoke_wheel.py` loads
    # this file to exercise the manifest logic without pulling in branca,
    # numpy and pandas. The suite can't stub `sys.modules` instead — pytest
    # imports every test module at collection time, so a stub leaks into
    # every other test in the session.
    import folium

    import foliplus

    version = importlib.metadata.version("foliplus")
    # Anchor the manifest check and the render on `__file__` — the directory the
    # import above resolved to, and the same anchor `BaseControl.dist_dir` uses.
    # Both halves of this script therefore read one and the same `dist/`, which
    # is what makes the render a valid certificate of the manifest's files.
    package_dir = Path(foliplus.__file__).resolve().parent
    print(f"foliplus {version} at {package_dir}")
    assert_not_source_checkout(foliplus)

    # Verify the installed package's dist/ before rendering anything, so a
    # missing bundle is reported as a packaging defect rather than surfacing
    # later as an unexpected error mid-render.
    dist_dir = package_dir / "dist"
    listed = check_manifest(dist_dir)
    print(f"dist/: {len(listed)} components, all artifacts present")

    classes = locate_controls(foliplus)
    assert classes, "no control classes exported from foliplus"

    # Read the bundles back through the same anchor as the manifest, so a
    # render can never certify a wheel whose files it never opened.
    for cls in classes:
        render_control(folium, cls, dist_dir / f"foliplus-{cls.__name__}.min.js")

    print(
        f"rendered {len(classes)} controls: "
        f"{', '.join(sorted(c.__name__ for c in classes))}"
    )


if __name__ == "__main__":
    main()
