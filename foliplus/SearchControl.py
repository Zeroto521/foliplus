from __future__ import annotations

from typing import Literal, get_args

from ._cdn_loader import load_cdn
from ._typing import Position
from .BaseControl import BaseControl
from .locale import LocaleConfig

MODE = Literal["coord", "addr"]
PROVIDER_IDS = ("nominatim", "photon", "pelias")


class SearchControl(BaseControl):
    """Coordinate and address search with a pluggable geocode provider.

    - 📍 **Coordinate search**: enter a coordinate like `longitude, latitude` to fly to
      and place a marker.
    - 🌐 **Address search**: enter a keyword and geocode via a provider.

    The geocode provider is pluggable. Built-in providers are ``"nominatim"``
    (OpenStreetMap, default), ``"photon"`` (komoot) and ``"pelias"``. Pass a
    dict to define a custom provider (see below).

    Shortcuts
    ---------
    Focus a layer row by clicking it, then use:

    .. list-table::
       :header-rows: 1

       * - Key
         - Action
       * - Escape
         - Close the search panel or dismiss suggestions
       * - ArrowDown
         - Move to the next suggestion
       * - ArrowUp
         - Move to the previous suggestion

    Parameters
    ----------
    position : str, default "topleft"
        One of "topleft", "topright", "bottomleft", "bottomright".

    mode : Literal["coord", "addr"], default "coord"
        Default search mode on first open.

    zoom : int, default 15
        Zoom level after coordinate search.

    provider : str or dict, default "nominatim"
        Geocode provider. A built-in id (``"nominatim"``, ``"photon"``,
        ``"pelias"``) or a custom provider dict with keys:

        - ``id`` (required): unique provider id.
        - ``baseUrl``: API root, e.g. ``"https://api.example.com"``.
        - ``throttleMs``: minimum ms between requests (default 1000).
        - ``headers``: extra request headers.
        - ``suggest`` / ``search`` / ``reverse``: ``{"url": ..., "params": ...}``
          where ``url`` supports the ``{q}`` ``{limit}`` ``{lon}`` ``{lat}``
          placeholders.
        - ``normalize``: ``{"suggest"/"search"/"reverse": "<arrow fn source>"}``
          mapping a raw API response to foliplus' internal shape (evaluated in
          the browser; authored by the map creator, never by end users).

    provider_config : dict, optional
        Overrides for a built-in ``provider``: ``baseUrl``, ``throttleMs``,
        ``headers``. Only valid when ``provider`` is a string.

    locale : str or LocaleConfig, optional
        Language code ("en", "zh") or a LocaleConfig instance.
        Defaults to auto-detection, falling back to English.

    Examples
    --------
    >>> import folium
    >>> from foliplus import SearchControl
    >>> m = folium.Map()
    >>> SearchControl().add_to(m)

    >>> SearchControl(provider="photon").add_to(m)

    >>> SearchControl(
    ...     provider="pelias",
    ...     provider_config={"baseUrl": "https://geocode.example.com"},
    ... ).add_to(m)
    """

    _export_fields = ("mode", "zoom", "provider", "provider_config")

    default_js = load_cdn("SearchControl")

    def __init__(
        self,
        *,
        position: Position = "topleft",
        mode: MODE = "coord",
        zoom: int = 15,
        provider: str | dict = "nominatim",
        provider_config: dict | None = None,
        locale: str | LocaleConfig | None = None,
    ):
        if mode not in get_args(MODE):
            raise ValueError(f"mode must be one of {get_args(MODE)}, got {mode!r}")
        if not isinstance(zoom, int) or zoom < 1 or zoom > 18:
            raise ValueError(f"zoom must be an int between 1 and 18, got {zoom!r}")
        if isinstance(provider, str):
            if provider not in PROVIDER_IDS:
                raise ValueError(
                    f"provider must be one of {PROVIDER_IDS}, got {provider!r}"
                )
            if provider_config is not None and not isinstance(provider_config, dict):
                raise ValueError("provider_config must be a dict or None")
        elif isinstance(provider, dict):
            if "id" not in provider:
                raise ValueError("custom provider dict must contain an 'id' key")
            if provider_config is not None:
                raise ValueError(
                    "provider_config is only valid with a built-in string provider"
                )
        else:
            raise ValueError(
                f"provider must be a str or dict, got {type(provider).__name__}"
            )

        super().__init__(position=position, locale=locale)
        self.mode = mode
        self.zoom = zoom
        self.provider = provider
        self.provider_config = provider_config
        self._template = self._get_template()
