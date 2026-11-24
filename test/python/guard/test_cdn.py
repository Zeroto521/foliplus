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

ROOT = Path(__file__).resolve().parents[3]
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


def _cdn_data() -> dict[str, dict[str, str]]:
    return json.loads(_CDN_JSON.read_text(encoding="utf-8"))


def _cdn_packages() -> dict[str, int]:
    """``{npm package name: major version}`` extracted from every cdn.json URL."""
    packages: dict[str, int] = {}
    for entries in _cdn_data().values():
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


#: External assets a rendered folium page loads. Tiles and attribution links
#: are not assets: tiles are answered by the offline route policy, and the
#: copyright link is never fetched.
_ASSET_TAG_RE = re.compile(r'<(?:script|link)[^>]+(?:src|href)="(https?://[^"]+)"')


def _rendered_asset_urls() -> set[str]:
    """Every external script/link URL a plain folium page references."""
    import folium

    html = folium.Map(location=[0, 0], zoom_start=2).get_root().render()
    return set(_ASSET_TAG_RE.findall(html))


class TestRenderedPageAssetsAreCached:
    """A rendered page must not reference an asset the offline route cannot serve.

    The route serves cdn.json from the local cache; an asset missing from
    cdn.json used to fall through to the runner's network, so the page's
    fonts/CSS (FontAwesome, glyphicons, jQuery) loaded only when the runner
    had internet. That is the same runner-dependence the geocode flake had,
    one layer down: a folium bump that adds a CDN link must be a cdn.json
    edit, not a silent network fetch.
    """

    def test_every_rendered_asset_is_in_the_cdn_cache(self):
        from conftest import _is_cdn_url

        missing = sorted(url for url in _rendered_asset_urls() if not _is_cdn_url(url))
        assert not missing, (
            "rendered folium page references assets missing from "
            "test/python/cdn.json:\n  " + "\n  ".join(missing)
        )


class TestTestCacheCoversProductionCdn:
    """Every CDN dependency a control declares must be in the test cache.

    ``foliplus/cdn.json`` is what a rendered page loads; ``test/python/cdn.json``
    is what the offline route serves. When the two drift, the browser suite
    silently falls back to the runner's network for that dependency (the
    geocode flake's failure mode, one layer down).
    """

    def test_every_production_cdn_url_is_cached(self):
        from conftest import _is_cdn_url

        production = json.loads(
            (ROOT / "foliplus" / "cdn.json").read_text(encoding="utf-8")
        )
        urls = {url for component in production.values() for url in component.values()}
        missing = sorted(url for url in urls if not _is_cdn_url(url))
        assert not missing, (
            "foliplus/cdn.json URLs missing from test/python/cdn.json:\n  "
            + "\n  ".join(missing)
        )
