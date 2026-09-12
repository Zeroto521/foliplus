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
Exits non-zero if no control can render.
"""

from __future__ import annotations

import importlib.metadata
import inspect
import sys
import traceback

import folium

import foliplus


def locate_controls() -> list[type]:
    """The exported `*Control` classes, excluding the `BaseControl` abstract."""
    return [
        getattr(foliplus, n)
        for n in sorted(dir(foliplus))
        if n.endswith("Control")
        and n != "BaseControl"
        and isinstance(getattr(foliplus, n), type)
    ]


def renderable(cls: type) -> tuple[bool, str]:
    """Can `cls()` be constructed with no arguments?

    Controls ship their own `dist/` bundle, so rendering one exercises the
    whole packaging path. A control that needs arguments cannot be exercised
    this way — it is reported, not silently dropped, so a newly added control
    that fails this check still shows up.

    Only a missing-argument `TypeError` counts as "not renderable". Anything
    else is a real construction failure and must fail the run, or a control
    that raises at init would be quietly listed under "skipped".
    """
    try:
        cls()
    except TypeError as exc:
        if not is_missing_argument(exc):
            return False, f"raised {exc}"
        return False, "requires " + ", ".join(required_arguments(cls))
    return True, ""


def is_missing_argument(exc: TypeError) -> bool:
    """True if `exc` says a required argument was not supplied.

    Leaflet-free, message-based: the stdlib phrasing varies by Python version.
    """
    return any(
        phrase in str(exc)
        for phrase in ("missing required", "positional argument", "argument(s)")
    )


def required_arguments(cls: type) -> list[str]:
    """Names of the constructor's arguments that have no default.

    `inspect.signature(cls.__init__)` exposes `self`, so the leading positional
    parameter is dropped by hand rather than assumed away.
    """
    params = inspect.signature(cls.__init__).parameters.values()
    out = []
    for i, p in enumerate(params):
        if i == 0 and p.kind is inspect.Parameter.POSITIONAL_OR_KEYWORD:
            continue
        if p.default is inspect.Parameter.empty and p.kind in (
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
            inspect.Parameter.KEYWORD_ONLY,
        ):
            out.append(p.name)
    return out


def render_control(cls: type) -> bool:
    """Render one control onto a blank map. Returns False on assertion failure."""
    name = cls.__name__
    try:
        m = folium.Map(location=[40.4, -3.7])
        cls().add_to(m)
        # `add_to` can swap the map's root for a Figure, so render the root.
        html = m.get_root().render()
    except Exception:
        traceback.print_exc()
        print(f"  ✗ {name}: render raised")
        return False

    # The bundles are inlined into the document, so their *filenames* never
    # appear — match the esbuild banner, which carries the component name.
    if "· common" not in html:
        print(f"  ✗ {name}: shared bundle not emitted into <head>")
        return False
    if f"· {name}" not in html:
        print(f"  ✗ {name}: component bundle not emitted")
        return False
    return True


def main() -> int:
    version = importlib.metadata.version("foliplus")
    origin = (
        importlib.metadata.distribution("foliplus").locate_file("foliplus").as_posix()
    )
    print(f"foliplus {version} at {origin}")

    classes = locate_controls()
    if not classes:
        print("✗ no control classes exported from foliplus")
        return 1

    ok, skipped = [], []
    for cls in classes:
        can, hint = renderable(cls)
        if not can:
            skipped.append((cls.__name__, hint))
            continue
        if render_control(cls):
            ok.append(cls.__name__)

    print(f"rendered {len(ok)}/{len(classes)}: {', '.join(ok)}")
    if skipped:
        for name, hint in skipped:
            print(f"  - {name}: not rendered ({hint})")

    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
