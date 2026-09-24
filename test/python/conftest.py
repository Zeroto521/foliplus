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

import json
import os
import re
import shutil
import tempfile
import time
import urllib.request
import warnings
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
# Minimum free space on the cache volume before we let a download attempt start.
# A full disk would stall retries inside a page.route handler, which surfaces
# as a spurious `Page.goto: Timeout` in whichever browser is waiting on it.
_CDN_MIN_FREE_BYTES = 32 * 1024 * 1024  # 32 MiB

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
    # Plugin assets referenced by folium 0.20 templates (MarkerCluster,
    # HeatMap). Fragments are full paths so `MarkerCluster.css` cannot
    # shadow `MarkerCluster.Default.css` (substring matching).
    "cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.1.0/leaflet.markercluster.js": (
        "leaflet.markercluster.js",
        "application/javascript",
    ),
    "cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.1.0/MarkerCluster.Default.css": (
        "MarkerCluster.Default.css",
        "text/css",
    ),
    "cdnjs.cloudflare.com/ajax/libs/leaflet.markercluster/1.1.0/MarkerCluster.css": (
        "MarkerCluster.css",
        "text/css",
    ),
    "cdn.jsdelivr.net/gh/python-visualization/folium@main/folium/templates/leaflet_heat.min.js": (
        "leaflet_heat.min.js",
        "application/javascript",
    ),
}


def _has_disk_space(path: Path, min_bytes: int) -> bool:
    """True if the filesystem holding *path* has at least *min_bytes* free.

    A full disk blocks ``urlopen`` retries inside the CDN route handler and
    surfaces as a ``Page.goto: Timeout`` in whatever browser is waiting on
    that route.  Failing closed to 404 keeps tests offline-immune in that
    case; better than timing out.
    """
    try:
        usage = shutil.disk_usage(str(path))
    except OSError:
        # Unknown (e.g. network filesystem quirk) — don't block on this.
        return True
    return usage.free >= min_bytes


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

        # Refuse to attempt the download if the cache volume is nearly full:
        # a retry loop would stall the whole page.route handler, which shows
        # up as a spurious ``Page.goto: Timeout`` in whichever browser is
        # waiting on that request.
        if not _has_disk_space(_CDN_CACHE_DIR, _CDN_MIN_FREE_BYTES):
            return None, None

        # Atomic download with retries for flaky CI networks.
        # Write to a temp file, fsync, then rename. Guards against concurrent
        # xdist workers reading a half-written file, and against a crash
        # between rename and disk commit leaving an empty "cache" file.
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
                    out.flush()
                    os.fsync(out.fileno())
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

    Tests read component stylesheets and the shared css/common/ modules
    for design-token assertions.  The cache avoids repeated disk I/O.

    A component entry may be an ``index.css`` that @imports its split
    modules; those statements are expanded inline the same way esbuild
    does at bundle time, so token assertions see the merged stylesheet.
    Relative imports (bare name or ``./`` prefix) resolve against the
    importing file's directory.
    """
    if path not in _css_cache:
        text = Path(path).read_text(encoding="utf-8")
        parts = []
        for line in text.splitlines():
            m = re.match(r'^\s*@import\s+["\']([^"\']+)["\']\s*;', line)
            if m:
                parts.append(read_css(str(Path(path).parent / m.group(1))))
            else:
                parts.append(line)
        _css_cache[path] = "\n".join(parts)
    return _css_cache[path]


def read_css_dir(path: str, name: str) -> str:
    """Read one module of a shared stylesheet folder, with caching.

    ``path`` is the folder (``foliplus/css/common``) and ``name`` the
    module inside it (``token.css``).  Assertions name the module that
    owns the rule they check, so a token moving between modules shows up
    as a precise test failure instead of a vague whole-file miss.

    Unlike :func:`read_css`, this deliberately reads the module file
    verbatim: a component entry's ``@import`` chain is expanded (matching
    the bundle), but a shared module's own ``@import`` dependencies are
    NOT pulled in — the caller asserts on the module that owns the rule.
    """
    key = f"{path}/{name}"
    if key not in _css_cache:
        _css_cache[key] = Path(key).read_text(encoding="utf-8")
    return _css_cache[key]


def _install_cdn_route(target: Any) -> None:
    """Intercept CDN + tile requests so browser tests run offline.

    Known CDN scripts are served from the local cache; OSM tile requests are
    answered with 404 (Leaflet skips failed tiles) so pages don't stall on
    slow tile downloads.

    ``target`` may be either a ``BrowserContext`` (shared route — one handler
    covers every page in that context) or a ``Page`` (per-page fallback).
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

    target.route("**/*", handler)


# Playwright's default navigation timeout is 30 000 ms. Under CI contention
# the browser can sit on its main thread waiting for first paint, which
# makes ``page.goto`` trip the default. 45 s is a buffer, not a mask — it
# stops legitimate slow startup from being misread as a flake. Deliberately
# set on navigation only; per-action timeouts (click / wait_for_*) stay at
# Playwright defaults so real slowness in assertions still surfaces.
_BROWSER_DEFAULT_NAV_TIMEOUT_MS = 45_000


# ── Health probe (T150 flaky-95 investigation) ──
#
# Inert observer for browser tests under `-n 24` xdist load. Samples worker
# process + Chromium resource usage to a per-worker JSONL log under
# ``.foliplus/flaky95/`` so a future 95-anomaly-round can be attributed
# (context accumulation? worker resource exhaustion? Chromium spawn burst?)
# rather than filed as an unsolved flake.
#
# Sampling cadence is deliberately low (every Nth ``new_page()``) so the
# probe itself does not distort the very behaviour it is measuring.
# Threshold warnings fire once per metric per worker session — enough to
# leave a marker in the run log, quiet enough to not spam healthy rounds.
#
# Env overrides (all opt-out / opt-in; nothing in main defaults changes):
#   FOLIPLUS_HEALTH_PROBE=0       disable entirely (default on)
#   FOLIPLUS_HEALTH_SAMPLE_N=N    sample every Nth ``new_page()`` (default 8)
#   FOLIPLUS_BROWSER_MODE=shared  single session-scoped BrowserContext instead
#                                 of the baseline per-page context. Diagnostic
#                                 only — see T129 for the storage-isolation
#                                 caveat under ``file://`` origins.
#
# ``.foliplus/`` is gitignored; the probe leaves no tracked artifacts.
#
# T150 findings (2026-09-25, Windows, 15 baseline rounds of -n 24):
#   - 95-class anomaly reproduced (Round 14: 116 failures / 409 s; Round 12:
#     99 failures / 321 s) with per-page context baseline.
#   - Round 14 workers at page 8 show ``contexts`` = 1-5 (vs 1-2 in clean
#     rounds) and ``chromium_procs`` = 19-31 (vs 19-29 in clean rounds).
#   - Correlation: chromium process count tracks per-worker context count
#     one-to-one — each open context is a Chromium renderer/helper.
#   - 5 rounds of -n 12 (halved workers): 0 failures, ctxMax=1 throughout.
#   - Root cause: Windows process pressure at -n 24 causes intermittent
#     per-worker context accumulation, which cascades into the 95-anomaly
#     (workers stuck on page.goto timeouts, unable to progress past po=8).
#   - Fix (upstream): reduce JOBS to 12 for browser tests on Windows.
#
_HEALTH_PROBE_ENABLED = os.environ.get("FOLIPLUS_HEALTH_PROBE", "1") != "0"
_HEALTH_SAMPLE_N = int(os.environ.get("FOLIPLUS_HEALTH_SAMPLE_N", "8"))
_BROWSER_MODE = os.environ.get("FOLIPLUS_BROWSER_MODE", "per_page")
_HEALTH_DIR = Path(".foliplus") / "flaky95"
# Permissive thresholds — outliers only, not normal variance. Adjust after
# collecting a baseline distribution from the first round of clean runs.
_HEALTH_THRESHOLDS = {
    "rss_mb": 512,
    "contexts": 128,
    "chromium_procs": 32,
    "handles": 2000,
}


class _Flaky95Probe:
    """Per-worker sampler for browser-test resource health.

    Observes only: never raises, never mutates a test's browser, never
    fails a test from a probe exception. The proxy calls
    :meth:`maybe_sample` on each ``new_page()``; the fixture calls
    :meth:`close` at session end.
    """

    def __init__(self, worker_id: str, sample_n: int) -> None:
        self._worker_id = worker_id
        self._sample_n = max(1, sample_n)
        self._pages_opened = 0
        self._warned: set[str] = set()
        self._log_fh = None
        if _HEALTH_PROBE_ENABLED:
            _HEALTH_DIR.mkdir(parents=True, exist_ok=True)
            ts = time.strftime("%Y%m%d-%H%M%S")
            path = _HEALTH_DIR / f"health-{ts}-{worker_id}.jsonl"
            try:
                # Line-buffered so each sample is durable even under a
                # hard worker kill — that's the anomaly mode we want to
                # recover from, so losing samples to a buffer flush on
                # clean exit would defeat the purpose.
                self._log_fh = path.open("a", encoding="utf-8", buffering=1)
            except OSError:
                self._log_fh = None

    def maybe_sample(self, browser: Any) -> None:
        """Increment the page counter; sample if we're on a multiple of N."""
        self._pages_opened += 1
        if self._log_fh is None or self._pages_opened % self._sample_n:
            return
        snap = self._snapshot(browser)
        if snap is None:
            return
        self._warn_if_over(snap)
        try:
            self._log_fh.write(json.dumps(snap) + "\n")
        except Exception:
            # Never break a test from a probe failure.
            pass

    def _snapshot(self, browser: Any) -> dict[str, Any] | None:
        try:
            import psutil

            proc = psutil.Process(os.getpid())
            rss_mb = proc.memory_info().rss / 1024**2
            handles = getattr(proc, "num_handles", lambda: None)()
            threads = proc.num_threads()
        except Exception:
            rss_mb = handles = threads = None

        try:
            chromium_procs = sum(
                1
                for p in psutil.process_iter(["name"])
                if (p.info or {}).get("name", "").lower() in ("chrome.exe", "chrome")
            )
        except Exception:
            chromium_procs = None

        contexts = pages_open = None
        try:
            contexts = len(browser.contexts)
            pages_open = sum(len(ctx.pages) for ctx in browser.contexts)
        except Exception:
            pass

        return {
            "ts": round(time.time(), 2),
            "worker": self._worker_id,
            "pid": os.getpid(),
            "mode": _BROWSER_MODE,
            "rss_mb": round(rss_mb, 1) if rss_mb else None,
            "handles": handles,
            "threads": threads,
            "chromium_procs": chromium_procs,
            "contexts": contexts,
            "pages_open": pages_open,
            "pages_opened_total": self._pages_opened,
        }

    def _warn_if_over(self, snap: dict[str, Any]) -> None:
        for metric, threshold in _HEALTH_THRESHOLDS.items():
            value = snap.get(metric)
            if value is None or value <= threshold or metric in self._warned:
                continue
            self._warned.add(metric)
            try:
                warnings.warn(
                    f"[flaky-95] {metric}={value} exceeds threshold "
                    f"{threshold} (worker={snap['worker']}, pid={snap['pid']}, "
                    f"pages_opened_total={snap['pages_opened_total']})",
                    UserWarning,
                    stacklevel=2,
                )
            except Exception:
                pass

    def close(self) -> None:
        if self._log_fh is not None:
            try:
                self._log_fh.close()
            except Exception:
                pass
            self._log_fh = None


class _CdnBrowserProxy:
    """Wrap a Playwright Browser so every ``new_page()`` gets the CDN route.

    ``browser.new_page()`` internally creates a fresh ``BrowserContext``,
    which isolates ``localStorage`` / cookies / caches natively — one
    test never sees another's storage. ``page.reload()`` inside a single
    test preserves what it wrote (persistence tests rely on this).

    Routing is installed per page because the underlying context is not
    exposed; this is the baseline behaviour. The proxy also raises the
    navigation timeout from Playwright's 30 s default to 45 s so a
    legitimate slow first-paint doesn't trip as a flake on loaded CI.
    """

    def __init__(self, browser: Browser, probe: _Flaky95Probe | None = None) -> None:
        self._browser = browser
        self._probe = probe

    def __getattr__(self, name: str):
        return getattr(self._browser, name)

    def new_page(self, *args, **kwargs):
        page = self._browser.new_page(*args, **kwargs)
        _install_cdn_route(page)
        page.set_default_navigation_timeout(_BROWSER_DEFAULT_NAV_TIMEOUT_MS)
        if self._probe is not None:
            self._probe.maybe_sample(self._browser)
        return page


class _SharedContextBrowserProxy:
    """Variant of :class:`_CdnBrowserProxy` that shares one BrowserContext.

    Diagnostic only (T150 comparison experiment): exercises the shared-context
    path #448 originally attempted, so the 95-anomaly hypothesis "context
    accumulation inside one context" can be tested against the reverted
    per-page baseline. T129 found this variant breaks
    ``test_saved_bounds_restore`` under ``file://`` origins (sessionStorage
    marker fires an unwanted ``localStorage.clear`` on reload) — that failure
    is expected evidence, not a regression.
    """

    def __init__(self, browser: Browser, probe: _Flaky95Probe | None = None) -> None:
        self._browser = browser
        self._probe = probe
        self._context = browser.new_context()
        # Route installed on the context covers every page in it — one
        # handler, not one per page.
        _install_cdn_route(self._context)

    def __getattr__(self, name: str):
        return getattr(self._browser, name)

    def new_page(self, *args, **kwargs):
        page = self._context.new_page(*args, **kwargs)
        page.set_default_navigation_timeout(_BROWSER_DEFAULT_NAV_TIMEOUT_MS)
        if self._probe is not None:
            self._probe.maybe_sample(self._browser)
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


def make_browser_page(
    browser, tmp_path, html: str, name: str = "page", prelude: str | None = None
):
    """Write *html* to a temp file and return a Playwright page with console
    error collection.

    Parameters
    ----------
    prelude
        Optional JS source run *before* the page's own scripts (via
        ``page.add_init_script``). A listener-counting probe needs this to see
        the whole page lifetime rather than only what happens after it
        installs, so its counts are absolute instead of relative to itself.

    Returns
    -------
    tuple[Page, list[str]]
        ``(page, errors)`` where *errors* is a list of ``console.error`` messages
        (excluding resource-load failures).
    """
    html_path = tmp_path / f"{name}.html"
    html_path.write_text(_inject_window_map(html), encoding="utf-8")
    page = browser.new_page()
    if prelude is not None:
        page.add_init_script(prelude)
    errors: list[str] = []
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


def panel_ready(page: Page, timeout: float = 5000) -> None:
    """Wait until the layer panel finished its init pass.

    LayerControl marks ``.foliplus-panel-content`` with ``data-ready`` when
    ``initTypesAndVisibility`` completes (checkbox titles / ``.active`` /
    counts are final for the current layer set). Replaces the hand-written
    ``wait_for_function(title non-empty)`` boilerplate — the ready criterion
    lives in one place.
    """
    page.wait_for_selector(
        ".foliplus-panel-content[data-ready]", state="attached", timeout=timeout
    )


def heatmap_ready(page: Page, timeout: float = 5000) -> None:
    """Wait until the heatmap finished its initial point-layer scan.

    HeatmapControl marks its root with ``data-ready`` when the scan settles
    (dropdown rebuilt with layers, or the no-layer hint shown). Replaces the
    ``wait_for_timeout`` boilerplate after panel expand / reload.
    """
    page.wait_for_selector(
        ".foliplus-heatmap-ctrl[data-ready]", state="attached", timeout=timeout
    )


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
def browser() -> Generator[_CdnBrowserProxy, None, None]:
    """Launch a headless Chromium once per session.

    Every ``new_page()`` returns a page on a fresh ``BrowserContext`` (see
    ``_CdnBrowserProxy``), so tests don't share ``localStorage`` / cookies.
    The CDN route is installed on each context so browser tests run offline.

    Skipped if Playwright is not installed::

        pip install playwright
        playwright install chromium
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    # Warm the CDN cache before any page loads so slow downloads can't stall
    # navigation during the run (main source of flaky browser tests on CI).
    _prefetch_cdn_cache()

    # Per-worker health probe (see module-level T150 block). Worker id comes
    # from xdist's env; falls back to "master" for serial runs so the log
    # filename is always meaningful.
    worker_id = os.environ.get("PYTEST_XDIST_WORKER", "master")
    probe = _Flaky95Probe(worker_id, _HEALTH_SAMPLE_N)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        if _BROWSER_MODE == "shared":
            proxy = _SharedContextBrowserProxy(browser, probe)
        else:
            proxy = _CdnBrowserProxy(browser, probe)
        yield proxy
        probe.close()
        browser.close()
