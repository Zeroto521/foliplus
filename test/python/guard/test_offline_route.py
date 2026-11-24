"""Offline browser-network policy for the Playwright test harness.

A browser test page is a file:// document, so its origin is "null". Any
request that reaches the runner's network makes the suite depend on runner
connectivity: online, a cross-origin fetch without a CORS header logs a
console error that fails every "assert not errors" test; offline, the same
request fails a different way. That is how the geocode-flake round turned
into 17 CORS failures that looked like product regressions.

The policy in conftest.py answers every http(s) request deterministically
(CDN cache, tile 404, provider-shaped geocode fixture, generic asset). These
tests pin the classification tables, the route handler invariant that no
http(s) request may fall through to the network, and the end-to-end browser
result.
"""

from __future__ import annotations

import json

import conftest
from conftest import (
    _FIXTURE_ADDRESS,
    _external_reply,
    _is_tile_url,
    _make_route_handler,
    _route_reply,
    make_browser_page,
    use_page,
)

_NOMINATIM_REVERSE = (
    "https://nominatim.openstreetmap.org/reverse"
    "?lon=119.30&lat=26.08&zoom=18&format=jsonv2&accept-language=en"
)
_NOMINATIM_SEARCH = (
    "https://nominatim.openstreetmap.org/search?format=jsonv2&q=test&limit=1"
)


class _FakeRequest:
    """The two request attributes the route handler reads."""

    def __init__(self, url: str, resource_type: str = "fetch") -> None:
        self.url = url
        self.resource_type = resource_type


class _FakeRoute:
    """Minimal Playwright Route double that records the handler decision."""

    def __init__(self, url: str, resource_type: str = "fetch") -> None:
        self.request = _FakeRequest(url, resource_type)
        self.fulfilled: dict[str, object] | None = None
        self.continued = False
        self.aborted = False

    def fulfill(self, **kwargs: object) -> None:
        self.fulfilled = kwargs

    def continue_(self) -> None:
        self.continued = True

    def abort(self) -> None:
        self.aborted = True


class TestGeocodeClassification:
    """Geocode hosts answer provider-shaped JSON, never the network."""

    def test_reverse_geocode_is_an_object_with_display_name(self):
        reply = _external_reply(_NOMINATIM_REVERSE, "fetch")
        assert reply is not None
        assert reply.kind == "geocode"
        assert reply.content_type == "application/json"
        payload = json.loads(reply.body)
        assert payload["display_name"] == _FIXTURE_ADDRESS
        assert payload["address"]["city"]

    def test_forward_geocode_is_a_list(self):
        reply = _external_reply(_NOMINATIM_SEARCH, "fetch")
        assert reply is not None
        payload = json.loads(reply.body)
        assert isinstance(payload, list)
        assert payload[0]["lon"] and payload[0]["lat"]

    def test_photon_reverse_is_a_feature_collection(self):
        reply = _external_reply(
            "https://photon.komoot.io/reverse?lon=119.30&lat=26.08", "fetch"
        )
        assert reply is not None
        payload = json.loads(reply.body)
        assert payload["type"] == "FeatureCollection"
        assert payload["features"][0]["geometry"]["type"] == "Point"

    def test_pelias_reverse_is_a_feature_collection(self):
        reply = _external_reply(
            "https://api.demo.pelias.io/v1/reverse?point.lon=1&point.lat=2", "fetch"
        )
        assert reply is not None
        payload = json.loads(reply.body)
        assert payload["features"][0]["properties"]["label"]


class TestTileClassification:
    """Every tile endpoint the controls/tests reference is answered 404."""

    TILE_URLS = (
        "https://a.tile.openstreetmap.org/12/3340/1720.png",
        "https://b.tile.openstreetmap.org/7/104/53.png",
        "https://tile.openstreetmap.org/3/4/2.png",
        "https://tiles.foliplus.test/12/3340/1720.png",
        "https://a.basemaps.cartocdn.com/light_all/12/3340/1720.png",
        "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/"
        "World_Dark_Gray_Base/MapServer/tile/12/1720/3340",
        "https://stamen-tiles-a.a.ssl.fastly.net/terrain/12/3340/1720.png",
        "https://t0.tianditu.com/DataServer?T=vec_w&x=1&y=2&l=3",
        "https://webrd01.autonavi.com/appmaptile?x=1&y=2&z=3",
        "https://wprd01.amap.com/appmaptile?x=1&y=2&z=3",
        "https://p2.map.gtimg.com/maptilesv2/12/3340/1720/1.png",
        "https://online1.bdimg.com/tile/?qt=tile&x=1&y=2&z=3",
    )

    def test_tile_urls_are_recognised(self):
        for url in self.TILE_URLS:
            assert _is_tile_url(url), url

    def test_tile_images_answer_404(self):
        for url in self.TILE_URLS:
            reply = _external_reply(url, "image")
            assert reply is not None
            assert reply.kind == "tile"
            assert reply.status == 404


class TestDefaultPolicy:
    """Unknown external hosts are answered by resource type (deterministic)."""

    def test_non_http_schemes_are_not_ours(self):
        for url in (
            "file:///tmp/page.html",
            "data:text/plain,hi",
            "blob:null/1234",
        ):
            assert _external_reply(url, "document") is None

    def test_unknown_fetch_gets_empty_json(self):
        reply = _external_reply("https://example.com/api/thing", "fetch")
        assert reply is not None
        assert reply.status == 200
        assert json.loads(reply.body) == {}

    def test_unknown_image_gets_404(self):
        reply = _external_reply("https://example.com/icon.png", "image")
        assert reply is not None
        assert reply.status == 404

    def test_unknown_script_gets_an_empty_body(self):
        reply = _external_reply("https://example.com/app.js", "script")
        assert reply is not None
        assert reply.status == 200
        assert reply.body == b""


class TestHandlerInvariant:
    """The bug this policy fixes: an http(s) route falling through to the net.

    The handler is the only place that can choose continue_(); these cases
    fail if any external http(s) request regresses to network forwarding.
    """

    HTTP_CORPUS = (
        _NOMINATIM_REVERSE,
        _NOMINATIM_SEARCH,
        "https://photon.komoot.io/api/?q=test&limit=1",
        "https://api.demo.pelias.io/v1/search?text=test&size=1",
        "https://a.tile.openstreetmap.org/12/3340/1720.png",
        "https://tiles.foliplus.test/12/3340/1720.png",
        "https://a.basemaps.cartocdn.com/light_all/12/3340/1720.png",
        "https://example.com/anything.json",
        "https://api.github.com/repos/owner/repo",
    )

    def test_handler_never_continues_an_http_request(self, monkeypatch):
        # Keep the CDN branch deterministic too: a cache miss would otherwise
        # attempt a download inside this test.
        monkeypatch.setattr(conftest, "_cdn_cached", lambda url: (b"cdn", "text/plain"))
        handler = _make_route_handler()
        for url in self.HTTP_CORPUS:
            route = _FakeRoute(url)
            handler(route)
            assert not route.continued, url
            assert route.fulfilled is not None or route.aborted, url

    def test_route_reply_never_falls_through_for_http(self, monkeypatch):
        """No http(s) URL may resolve to None - that is the continue_() path."""
        monkeypatch.setattr(conftest, "_cdn_cached", lambda url: (b"", "text/plain"))
        for url in self.HTTP_CORPUS:
            assert _route_reply(_FakeRoute(url)) is not None, url

    def test_cdn_asset_is_served_from_the_cache(self, monkeypatch):
        monkeypatch.setattr(
            conftest, "_cdn_cached", lambda url: (b"leaflet", "text/javascript")
        )
        route = _FakeRoute(
            "https://cdn.jsdelivr.net/npm/leaflet@1.9.3/dist/leaflet.js", "script"
        )
        handler = _make_route_handler()
        handler(route)
        assert route.fulfilled is not None
        assert route.fulfilled["body"] == b"leaflet"
        assert route.fulfilled["headers"] == {"Access-Control-Allow-Origin": "*"}


class TestEscapeCount:
    """A reply-driven route must classify every request as answered."""

    def test_route_reply_answers_nominatim(self, monkeypatch):
        monkeypatch.setattr(conftest, "_cdn_cached", lambda url: (b"", "text/plain"))
        reply = _route_reply(_FakeRoute(_NOMINATIM_REVERSE))
        assert reply is not None
        assert reply.kind == "geocode"


class TestGeocodeBrowser:
    """End-to-end: a page fetch to Nominatim is served offline, error-free."""

    def test_nominatim_fetch_is_answered_without_console_errors(
        self, browser, tmp_path
    ):
        html = "<!doctype html><html><body></body></html>"
        with use_page(
            make_browser_page, browser, tmp_path, html, "offline-geocode"
        ) as (page, errors):
            result = page.evaluate(
                "async (url) => { const r = await fetch(url);"
                " return {status: r.status, body: await r.json()}; }",
                _NOMINATIM_REVERSE,
            )
        assert result["status"] == 200
        assert result["body"]["display_name"] == _FIXTURE_ADDRESS
        assert errors == []
