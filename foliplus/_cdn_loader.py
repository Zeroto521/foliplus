"""CDN dependency loader — reads cdn.json and provides per-control asset lists.

This is the single source of truth for CDN dependencies.

Entries in ``cdn.json`` take two shapes:

* ``{"depName": "https://..."}`` — classic ``<script src>`` (the historical
  form; every existing control still uses this).
* ``{"depName": {"kind": "classic"|"module"|"css", "url": "https://..."}}`` —
  explicit kind. ``classic`` (the default when omitted) goes to folium's
  ``default_js``; ``module`` becomes a ``<script type="module">`` injected via
  ``html.add_child``; ``css`` becomes a ``<link rel="stylesheet">`` injected
  via ``header.add_child``.

The three public functions partition entries by kind so each caller can
consume exactly the subset it needs.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_CDN_PATH = Path(__file__).parent / "cdn.json"
_cache: dict[str, dict[str, Any]] | None = None

#: The three kinds a cdn.json entry can declare. ``classic`` is the historical
#: default and maps to folium's ``default_js`` (which can only emit classic
#: ``<script src>``). ``module`` and ``css`` go through folium's HTML injection
#: (``html.add_child`` / ``header.add_child``) because ``default_js`` cannot
#: set ``type`` or ``rel``.
_KINDS = frozenset({"classic", "module", "css"})


def _load_all() -> dict[str, dict[str, Any]]:
    global _cache
    if _cache is None:
        _cache = json.loads(_CDN_PATH.read_text(encoding="utf-8"))
    return _cache


def _resolve_entries(control_name: str) -> list[tuple[str, str, str]]:
    """Return ``(name, kind, url)`` for every entry of *control_name*.

    Resolves the two accepted shapes (bare URL or ``{kind, url}`` object) to a
    single triple so the kind-specific loaders share one parsing pass.
    """
    out: list[tuple[str, str, str]] = []
    for name, raw in _load_all().get(control_name, {}).items():
        if isinstance(raw, str):
            out.append((name, "classic", raw))
        else:
            kind = raw.get("kind", "classic")
            if kind not in _KINDS:
                raise ValueError(f"cdn.json: unknown kind {kind!r} for {name}")
            out.append((name, kind, raw["url"]))
    return out


def load_cdn(control_name: str) -> list[tuple[str, str]]:
    """Return the classic-script entries for *control_name*, in
    ``[(name, url), ...]`` form (folium's ``default_js`` contract)."""
    return [(n, u) for n, k, u in _resolve_entries(control_name) if k == "classic"]


def load_modules(control_name: str) -> list[tuple[str, str]]:
    """Return the ``<script type="module">`` entries for *control_name*."""
    return [(n, u) for n, k, u in _resolve_entries(control_name) if k == "module"]


def load_css(control_name: str) -> list[tuple[str, str]]:
    """Return the ``<link rel="stylesheet">`` entries for *control_name*."""
    return [(n, u) for n, k, u in _resolve_entries(control_name) if k == "css"]
