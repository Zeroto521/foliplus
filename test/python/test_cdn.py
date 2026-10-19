"""CDN ↔ npm major-version consistency.

``cdn.json`` is the single source of truth for CDN dependencies, but a few of
those packages are *also* npm devDependencies (test doubles, TS types). The two
sides can drift: a dependabot bump of npm ``pako`` to 3 leaves the browser
on the older major while ``global.d.ts`` resolves the type from the new one.

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


def _cdn_data() -> dict[str, dict[str, object]]:
    return json.loads(_CDN_JSON.read_text(encoding="utf-8"))


def _cdn_packages() -> dict[str, int]:
    """``{npm package name: major version}`` extracted from every cdn.json URL.

    Entries can be a bare string (classic ``<script src>``) or a dict with
    ``kind`` + ``url`` (module / css). Only the ``url`` field is scanned for
    npm package names.
    """
    packages: dict[str, int] = {}
    for entries in _cdn_data().values():
        for raw in entries.values():
            url = raw if isinstance(raw, str) else raw.get("url", "")
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

    def test_tests_read_cdn_urls_from_the_loader(self):
        """Test files must not hand-copy cdn.json urls.

        A ``<package>@<version>`` fragment copied out of cdn.json is what
        drifted on the pako bump: it had to be fixed in cdn.json, package.json
        and a test file at once. Only cdn.json package names are matched, so
        deps that are not foliplus's (leaflet, folium, bootstrap) are skipped.
        """
        names = {n for entries in _cdn_data().values() for n in entries}
        hits: list[str] = []
        for path in sorted((ROOT / "test" / "python").glob("*.py")):
            text = path.read_text(encoding="utf-8")
            for name in sorted(names):
                for m in re.finditer(rf"{re.escape(name)}@\d", text):
                    hits.append(
                        f"{path.name}:{text.count(chr(10), 0, m.start()) + 1} {m.group()}"
                    )
        assert not hits, (
            "hardcoded cdn.json urls in tests — read them via "
            "load_cdn(<Control>) instead:\n  " + "\n  ".join(hits)
        )


class TestCdnLoaderKindDispatch:
    """load_cdn / load_modules / load_css partition entries by kind."""

    def test_load_cdn_returns_only_classic(self):
        """load_cdn returns only bare-string (classic) entries."""
        from foliplus._cdn_loader import load_cdn

        results = load_cdn("LayerControl")
        for _name, _url in results:
            raw = _cdn_data()["LayerControl"].get(_name)
            assert raw is None or isinstance(raw, str), (
                f"{_name} is not a classic entry but was returned by load_cdn"
            )

    def test_load_modules_returns_only_modules(self):
        """load_modules returns only kind=module entries."""
        from foliplus._cdn_loader import load_modules

        results = load_modules("LayerControl")
        names = {n for n, _u in results}
        assert "wa-slider" in names, (
            "wa-slider is kind=module in cdn.json but load_modules missed it"
        )
        for name, url in results:
            raw = _cdn_data()["LayerControl"].get(name, {})
            assert isinstance(raw, dict) and raw.get("kind") == "module"

    def test_load_css_returns_only_css(self):
        """load_css returns only kind=css entries."""
        from foliplus._cdn_loader import load_css

        results = load_css("LayerControl")
        names = {n for n, _u in results}
        assert {"wa-theme", "wa-brand"} <= names, (
            f"wa-theme/wa-brand are kind=css but load_css returned {names}"
        )
        for name, url in results:
            raw = _cdn_data()["LayerControl"].get(name, {})
            assert isinstance(raw, dict) and raw.get("kind") == "css"

    def test_classic_control_loads_via_load_cdn_only(self):
        """A control with only classic entries returns [] for modules and css."""
        from foliplus._cdn_loader import load_css, load_modules

        cdn = _cdn_data()
        classic_only = [
            k for k, v in cdn.items() if all(isinstance(e, str) for e in v.values())
        ]
        assert classic_only, "no classic-only control in cdn.json"
        ctrl = classic_only[0]
        assert load_modules(ctrl) == []
        assert load_css(ctrl) == []
