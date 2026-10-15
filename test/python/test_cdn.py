"""CDN ↔ npm major-version consistency.

``cdn.json`` is the single source of truth for CDN dependencies, but a few of
those packages are *also* npm devDependencies (test doubles, TS types). The two
sides can drift: a dependabot bump of npm ``pako`` to 3 leaves the browser
loading ``pako@2`` while ``global.d.ts`` resolves the type from 3.

Browser tests stub every CDN global, so nothing ever loads the real CDN build —
``cdn.json``'s versions are otherwise unverified. This test is the guard.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "foliplus"

_CDN_JSON = PKG / "cdn.json"
_PACKAGE_JSON = ROOT / "package.json"

#: ``https://cdn.jsdelivr.net/npm/<name>@<version>/...`` — scoped names
#: (``@turf/turf``) start with ``@``, so match that shape before the bare one.
_NPM_URL = re.compile(r"npm/(@[^/@]+/[^/@]+|[^/@]+)@([^/\s]+)")
_MAJOR = re.compile(r"\d+")

#: Tripwire only — the mismatch test is fully data-driven. If the URL extractor
#: ever stops resolving these, every comparison below silently skips and the
#: guard passes forever.
_EXPECTED_SHARED = frozenset({"pako", "geotiff", "h3-js"})


def _major_of(spec: str) -> int | None:
    """Leading major of a version spec: ``^2.1.0`` / ``2.1.0`` / ``~3`` → 2 / 2 / 3."""
    m = _MAJOR.search(spec)
    return int(m.group()) if m else None


def _cdn_packages() -> dict[str, int]:
    """``{npm package name: major version}`` extracted from every cdn.json URL."""
    data = json.loads(_CDN_JSON.read_text(encoding="utf-8"))
    packages: dict[str, int] = {}
    for entries in data.values():
        for url in entries.values():
            m = _NPM_URL.search(url)
            if not m:
                continue
            major = _major_of(m.group(2))
            if major is not None:
                packages[m.group(1)] = major
    return packages


def _npm_majors() -> dict[str, int]:
    """``{dependency name: major version}`` from package.json deps + devDeps.

    Exact key match only: ``@types/pako`` is never treated as ``pako``.
    """
    pkg = json.loads(_PACKAGE_JSON.read_text(encoding="utf-8"))
    majors: dict[str, int] = {}
    for section in ("dependencies", "devDependencies"):
        for name, spec in (pkg.get(section) or {}).items():
            major = _major_of(str(spec))
            if major is not None:
                majors[name] = major
    return majors


class TestCdnNpmVersionConsistency:
    def test_cdn_majors_match_npm_dependencies(self):
        cdn = _cdn_packages()
        npm = _npm_majors()
        mismatches = [
            f"{name}: cdn={cdn[name]} npm={npm[name]}"
            for name in sorted(cdn)
            if name in npm and cdn[name] != npm[name]
        ]
        assert not mismatches, (
            "cdn.json drifts from package.json:\n  "
            + "\n  ".join(mismatches)
            + "\nKeep the majors in lockstep — browser tests stub every CDN"
            " global, so nothing else ever loads the real CDN build."
        )

    def test_guard_still_covers_shared_packages(self):
        shared = set(_cdn_packages()) & set(_npm_majors())
        missing = sorted(_EXPECTED_SHARED - shared)
        assert not missing, (
            f"guard covers {sorted(shared)}, missing {missing}\n"
            "The URL extractor stopped resolving real packages — the guard is blind."
        )
