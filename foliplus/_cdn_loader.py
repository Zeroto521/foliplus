"""CDN dependency loader — reads cdn.json and provides per-control script lists.

This is the single source of truth for CDN dependencies.  Both Python
(controls) and Node.js (esbuild) can read the same cdn.json file.
"""

import json
from pathlib import Path

_CDN_PATH = Path(__file__).parent / "cdn.json"
_cache: dict | None = None


def _load_all() -> dict:
    global _cache
    if _cache is None:
        _cache = json.loads(_CDN_PATH.read_text(encoding="utf-8"))
    return _cache


def load_cdn(control_name: str) -> list[tuple[str, str]]:
    """Return the default_js list for a given control name.

    The returned list matches the format folium expects:
    ``[(name, url), ...]``.
    """
    data = _load_all()
    return data.get(control_name, [])
