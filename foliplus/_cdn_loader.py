"""CDN dependency loader — reads cdn.json and provides per-control script lists.

This is the single source of truth for CDN dependencies.
"""

import json
from pathlib import Path

CDN_PATH = Path(__file__).parent / "cdn.json"
cache: dict[str, dict[str, str]] | None = None


def load_all() -> dict[str, dict[str, str]]:
    global cache
    if cache is None:
        # cdn.json is a controlled source file, not a user-input boundary;
        # cache's annotation narrows json.loads's Any to the declared shape.
        cache = json.loads(CDN_PATH.read_text(encoding="utf-8"))
    return cache


def load_cdn(control_name: str) -> list[tuple[str, str]]:
    """Return the default_js list for a given control name.

    The returned list matches the format folium expects:
    ``[(name, url), ...]``.
    """
    data = load_all()
    return list(data.get(control_name, {}).items())
