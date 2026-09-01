"""Shared fixtures and utilities for foliplus tests.

Guidelines
----------
* PY tests verify the **Python ↔ JS bridge** only: config serialization, locale
  injection, CDN dependencies, shared-resource deduplication, CSS class/token presence,
  and Python-side class behavior.

* Do **not** assert JS function/variable names or internal logic — those belong in
  ``test/js/`` (vitest) or ``test/python/*Browser`` (playwright).
"""

from __future__ import annotations

import os
import re
import tempfile
import urllib.request
from collections.abc import Generator
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any

import folium
import pytest

if TYPE_CHECKING:
    from playwright.sync_api import Browser


# ── JS snippet reader (browser tests) ──
# Reads test/js/browser/<Component>/<name>.js for page.evaluate().
def _js(path: str) -> str:
    """Read a browser-test JS snippet, e.g. ``_js("LayerControl/read_layer_items")``."""
    return (Path(__file__).resolve().parent.parent / f"js/browser/{path}.js").read_text(
        encoding="utf-8"
    )


# ── CDN cache (browser tests) ──
#
# Browser tests load folium's base page which references CDN scripts
# (leaflet/jquery/bootstrap/awesome-markers).  In slow or flaky networks
# these can exceed Playwright's navigation timeout and produce spurious
# `Page.goto` timeouts.  We intercept those requests and serve them from a
# local cache (downloaded once to /tmp) so tests are network-independent.
_CDN_CACHE_DIR = Path("/tmp/foliplus-cdn-cache")
# Fast single-attempt prefetch during session setup — the per-request
# handler below retains the full retry budget for flaky CI networks.
_CDN_PREFETCH_TIMEOUT = 10  # seconds
_CDN_DOWNLOAD_TIMEOUT = 30  # seconds
_CDN_DOWNLOAD_RETRIES = 3  # retry attempts

# CDN URL fragment -> (cache filename, mime type)
_CDN_CACHE: dict[str, tuple[str, str]] = {
    "cdn.jsdelivr.net/npm/leaflet@1.9.3/dist/leaflet.js": (
        "leaflet.js",
        "application/javascript",
    ),
    "cdn.jsdelivr.net/npm/leaflet@1.9.3/dist/leaflet.css": (
        "leaflet.css",
        "text/css",
    ),
    "code.jquery.com/jquery-1.12.4.min.js": (
        "jquery-1.12.4.min.js",
        "application/javascript",
    ),
    "cdn.jsdelivr.net/npm/bootstrap@5.2.2/dist/js/bootstrap.bundle.min.js": (
        "bootstrap.bundle.min.js",
        "application/javascript",
    ),
    "cdnjs.cloudflare.com/ajax/libs/Leaflet.awesome-markers/2.0.2/leaflet.awesome-markers.js": (
        "leaflet.awesome-markers.js",
        "application/javascript",
    ),
    "cdnjs.cloudflare.com/ajax/libs/Leaflet.awesome-markers/2.0.2/leaflet.awesome-markers.css": (
        "leaflet.awesome-markers.css",
        "text/css",
    ),
}


def _cdn_cached(
    url: str, retries: int | None = None, timeout: float | None = None
) -> tuple[bytes | None, str | None]:
    """Return (bytes, mime) served from a local cache for a CDN url.

    Downloads once into ``_CDN_CACHE_DIR`` on first use, with a bounded
    timeout, retry attempts for flaky CI networks, and atomic write.
    ``retries``/``timeout`` override the defaults (used by prefetch for a
    single fast attempt).  Returns ``(None, None)`` for URLs outside the
    cache map so the request can be forwarded to the network as-is.
    """
    for fragment, (fname, mime) in _CDN_CACHE.items():
        if fragment not in url:
            continue

        _CDN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = _CDN_CACHE_DIR / fname
        if cache_path.exists():
            try:
                return cache_path.read_bytes(), mime
            except OSError:
                return None, None

        # Atomic download with retries for flaky CI networks.
        # Write to a temp file, then rename. Guards against concurrent
        # xdist workers reading a half-written file.
        attempt_count = retries if retries is not None else _CDN_DOWNLOAD_RETRIES
        per_attempt_timeout = timeout if timeout is not None else _CDN_DOWNLOAD_TIMEOUT
        for attempt in range(1, attempt_count + 1):
            fd, tmp_path = tempfile.mkstemp(dir=_CDN_CACHE_DIR, suffix=".part")
            try:
                with (
                    urllib.request.urlopen(url, timeout=per_attempt_timeout) as resp,
                    os.fdopen(fd, "wb") as out,
                ):
                    out.write(resp.read())
                os.replace(tmp_path, cache_path)
                break
            except Exception:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass
                if attempt == attempt_count:
                    return None, None
        try:
            return cache_path.read_bytes(), mime
        except OSError:
            return None, None
    return None, None


def _is_cdn_url(url: str) -> bool:
    """True if *url* matches a known CDN asset (fragment substring match)."""
    return any(fragment in url for fragment in _CDN_CACHE)


def _prefetch_cdn_cache() -> None:
    """Pre-download every CDN asset into the local cache.

    Called once at browser-session setup so that the first test does not
    pay the download cost inside a ``page.goto``.  Uses a single fast
    attempt (``_CDN_PREFETCH_TIMEOUT``); failures are ignored — the
    per-request handler retries with the full retry budget, so this only
    warms the cache for healthy networks instead of stalling setup.
    """
    _CDN_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    for fragment, (fname, _mime) in _CDN_CACHE.items():
        cache_path = _CDN_CACHE_DIR / fname
        if cache_path.exists():
            continue
        try:
            # Single fast attempt; the per-request handler retries if needed.
            _cdn_cached("https://" + fragment, retries=1, timeout=_CDN_PREFETCH_TIMEOUT)
        except Exception:
            continue


_css_cache: dict[str, str] = {}


def read_css(path: str) -> str:
    """Read a CSS file, caching the result in memory.

    Many tests read the same CSS file (LayerControl.css, common.css) for
    design-token assertions.  The cache avoids repeated disk I/O.
    """
    if path not in _css_cache:
        _css_cache[path] = Path(path).read_text(encoding="utf-8")
    return _css_cache[path]


def _install_cdn_route(page) -> None:
    """Intercept CDN + tile requests so browser tests run offline.

    Known CDN scripts are served from the local cache; OSM tile requests are
    answered with 404 (Leaflet skips failed tiles) so pages don't stall on
    slow tile downloads.
    """
    from playwright.sync_api import Route

    def handler(route: Route) -> None:
        url = route.request.url
        if "tile.openstreetmap.org" in url:
            route.fulfill(status=404, body=b"")
            return

        if not _is_cdn_url(url):
            # Non-CDN request (page document, tiles, foliplus assets):
            # let it through so the page can load.
            route.continue_()
            return

        data, mime = _cdn_cached(url)
        if data is None:
            # Known CDN asset whose download failed: answer 404 instead of
            # hitting the network.  Keeps browser tests offline and immune
            # to slow/flaky CDN downloads mid-run.
            route.fulfill(status=404, body=b"")
            return
        route.fulfill(status=200, body=data, content_type=mime)

    page.route("**/*", handler)


class _CdnBrowserProxy:
    """Wrap a Playwright Browser so every ``new_page()`` gets the CDN route.

    ``browser.new_page()`` is a shortcut for creating a fresh context + page,
    so there is no single context on which we can install a global route.
    Routing per-page via this proxy covers every test, including those that
    call ``browser.new_page()`` directly instead of ``make_browser_page``.
    """

    def __init__(self, browser: Browser) -> None:
        self._browser = browser

    def __getattr__(self, name: str):
        return getattr(self._browser, name)

    def new_page(self, *args, **kwargs):
        page = self._browser.new_page(*args, **kwargs)
        _install_cdn_route(page)
        return page


# ── Helpers ──


def resolve_js_unicode(text: str) -> str:
    """Decode ``\\uXXXX`` escape sequences in JS output to actual characters."""

    def _repl(m: re.Match) -> str:
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)

    return re.sub(r"\\u([0-9a-fA-F]{4})", _repl, text)


def render(m: folium.Map) -> str:
    """Render the map to HTML and decode JS Unicode escapes."""
    return resolve_js_unicode(m.get_root().render())


def render_control(ctrl, *, map: folium.Map | None = None) -> str:
    """Create a map, add a control, render, and return decoded HTML.

    Parameters
    ----------
    ctrl
        A foliplus control instance.
    map
        Optional pre-existing map. If ``None``, a fresh ``folium.Map`` is created.

    Returns
    -------
    str
        Decoded HTML string.
    """
    if map is None:
        map = folium.Map(location=[26.08, 119.30], zoom_start=12)
    ctrl.add_to(map)
    return render(map)


def assert_config_value(html: str, key: str, value: object) -> None:
    """Assert that ``key: value`` appears in the CONF JSON within *html*.

    Handles both ``"key": value`` and ``"key": "value"`` patterns.
    """
    if isinstance(value, str):
        assert f'"{key}": "{value}"' in html, (
            f'Expected CONF["{key}"] = "{value}" not found'
        )
    elif value is True:
        assert f'"{key}": true' in html, f'Expected CONF["{key}"] = true not found'
    elif value is False:
        assert f'"{key}": false' in html, f'Expected CONF["{key}"] = false not found'
    elif value is None:
        assert f'"{key}": null' in html, f'Expected CONF["{key}"] = null not found'
    else:
        assert f'"{key}": {value}' in html, (
            f'Expected CONF["{key}"] = {value} not found'
        )


def assert_locale(html: str, zh_text: str, en_key: str | None = None) -> None:
    """Assert that *zh_text* appears in a zh-rendered map.

    Parameters
    ----------
    html
        Rendered HTML string.
    zh_text
        Chinese translation text that should appear.
    en_key
        Optional English locale key that should also be present (e.g.
        ``"FullscreenControl.enter"``).
    """
    assert zh_text in html, f"Expected Chinese text {zh_text!r} not found"

    if en_key:
        assert en_key in html, f"Expected locale key {en_key!r} not found"


def assert_config_block(ctrl, expected: dict[str, Any]) -> None:
    """Assert that ``ctrl._build_config()`` contains the expected values.

    Only checks keys present in *expected*; extra keys are ignored.
    """
    config = ctrl._build_config()
    for key, value in expected.items():
        assert config.get(key) == value, (
            f"Expected config[{key!r}] = {value!r}, got {config.get(key)!r}"
        )


def _inject_window_map(html: str) -> str:
    """Expose the Leaflet map instance as ``window.map`` for browser snippets.

    Folium names the map variable ``map_<name>`` and renders its scripts after
    ``</body>`` but before ``</html>``; snippets run in ``page.evaluate`` and
    need a stable global to reach per-map APIs (e.g. ``map.foliplus.LayerAPI``).
    """
    match = re.search(r"var (map_[0-9a-f]+) = L\.map", html)
    if match:
        return html.replace(
            "</html>",
            f"<script>window.map = {match.group(1)};</script></html>",
        )
    return html


def make_browser_page(browser, tmp_path, html: str, name: str = "page"):
    """Write *html* to a temp file and return a Playwright page with console
    error collection.

    Returns
    -------
    tuple[Page, list[str]]
        ``(page, errors)`` where *errors* is a list of ``console.error`` messages
        (excluding resource-load failures).
    """
    html_path = tmp_path / f"{name}.html"
    html_path.write_text(_inject_window_map(html), encoding="utf-8")
    page = browser.new_page()
    errors: list[str] = []
    # Freeze the ExportControl smooth-nudge rafLoop: the manager reads
    # window.__rafScheduler on each rafLoop creation to drive its timer. In
    # production it is setTimeout (~60Hz); here we inject a no-op so only the
    # rafLoop's *synchronous* first frame fires — one nudge per keydown
    # (mirroring OS key-repeat) — and the continuation loop never re-arms.
    # This makes the release cleanup (.dragging removal on keyup) happen
    # deterministically with no waits for timer frames.
    page.add_init_script("window.__rafScheduler = function(fn) { return 0; };")
    page.on(
        "console",
        lambda msg: (
            errors.append(msg.text)
            if msg.type == "error"
            and not msg.text.startswith("Failed to load resource")
            else None
        ),
    )
    page.goto(f"file://{html_path}", wait_until="domcontentloaded")
    return page, errors


@contextmanager
def use_page(make_fn: Callable[..., tuple], *args: Any, **kwargs: Any):
    """Build a Playwright page via *make_fn*, yield ``(page, errors)``, close on exit.

    Replaces the ubiquitous boilerplate::

        page, errors = self._make_page(browser, tmp_path)
        try:
            # ... assertions ...
        finally:
            page.close()

    with::

        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            # ... assertions ...

    *make_fn* must return a ``(page, errors)`` tuple (see :func:`make_browser_page`).
    """
    page, errors = make_fn(*args, **kwargs)
    try:
        yield page, errors
    finally:
        page.close()


@contextmanager
def use_raw_page(new_page_fn: Callable[[], Any], *args: Any, **kwargs: Any):
    """Create a raw Playwright page via *new_page_fn*, yield it, close on exit.

    For tests that need only a page (no error collection)::

        with use_raw_page(browser.new_page) as page:
            page.goto(...)
            # ... assertions ...
    """
    page = new_page_fn(*args, **kwargs)
    try:
        yield page
    finally:
        page.close()


# ── Fixtures ──


def pytest_collection_modifyitems(config, items):
    """Auto-mark tests that need a browser as pytest.mark.browser.

    Browser-based tests live in classes whose name ends with ``Browser`` (e.g.
    ``TestXxxBrowser``). This lets ``-m "not browser"`` exclude all playwright
    tests from the fast unit-test run.
    """
    for item in items:
        cls = item.getparent(pytest.Class)
        if cls is not None and cls.name.endswith("Browser"):
            item.add_marker(pytest.mark.browser)


@pytest.fixture
def base_map() -> folium.Map:
    """Provide a fresh map for each test."""
    return folium.Map(location=[26.08, 119.30], zoom_start=12)


@pytest.fixture
def rendered(base_map: folium.Map) -> str:
    """Render a map (after adding controls) to HTML."""
    return render(base_map)


@pytest.fixture(scope="session")
def browser() -> Generator[Browser, None, None]:
    """Launch a headless Chromium once per session.

    Every ``new_page()`` is wrapped with a CDN/tile route (see
    ``_CdnBrowserProxy``) so browser tests don't depend on a fast network.

    Skipped if Playwright is not installed::

        pip install playwright
        playwright install chromium
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    # Warm the CDN cache before any page loads so slow downloads can't stall
    # navigation during the run (main source of flaky browser tests on CI).
    _prefetch_cdn_cache()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        yield _CdnBrowserProxy(browser)
        browser.close()
