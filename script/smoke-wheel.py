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
`PYTHONPATH` at an install target, or run this outside the repo.

Usage: python script/smoke-wheel.py
Raises on the first failure (`SmokeFailure` for a bad artifact set,
`AssertionError` for a render gap); exits non-zero only through that
exception, so a traceback in CI means a broken wheel.
"""

from __future__ import annotations

import importlib.metadata
import json
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


def render_control(folium: ModuleType, cls: type) -> None:
    """Render one control onto a blank map, asserting both bundles emitted."""
    name = cls.__name__
    m = folium.Map(location=[40.4, -3.7])
    cls().add_to(m)
    # `add_to` can swap the map's root for a Figure, so render the root.
    html = m.get_root().render()

    # The bundles are inlined into the document, so their *filenames* never
    # appear — match the esbuild banner, which carries the source name. The
    # shared entry is bundled as "runtime", not "common", so `· common` never
    # matches: the real banner is `· runtime`, and checking the wrong string
    # is a check that silently passes on every wheel.
    assert "· runtime" in html, f"{name}: shared bundle not emitted into <head>"
    assert f"· {name}" in html, f"{name}: component bundle not emitted"


def main() -> None:
    # Imported here rather than at module level: `test_smoke_wheel.py` loads
    # this file to exercise the manifest logic without pulling in branca,
    # numpy and pandas. The suite can't stub `sys.modules` instead — pytest
    # imports every test module at collection time, so a stub leaks into
    # every other test in the session.
    import folium

    import foliplus

    version = importlib.metadata.version("foliplus")
    package_dir = importlib.metadata.distribution("foliplus").locate_file("foliplus")
    print(f"foliplus {version} at {package_dir}")

    # Verify the installed package's dist/ before rendering anything, so a
    # missing bundle is reported as a packaging defect rather than surfacing
    # later as an unexpected error mid-render.
    listed = check_manifest(package_dir / "dist")
    print(f"dist/: {len(listed)} components, all artifacts present")

    classes = locate_controls(foliplus)
    assert classes, "no control classes exported from foliplus"

    for cls in classes:
        render_control(folium, cls)

    print(
        f"rendered {len(classes)} controls: "
        f"{', '.join(sorted(c.__name__ for c in classes))}"
    )


if __name__ == "__main__":
    main()
