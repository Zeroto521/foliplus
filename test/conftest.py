"""Shared fixtures and utilities for foliplus tests."""

from __future__ import annotations

import re

import folium
import pytest


def resolve_js_unicode(text: str) -> str:
    """Decode \\uXXXX escape sequences in JS output to actual characters."""
    def _repl(m: re.Match) -> str:
        try:
            return chr(int(m.group(1), 16))
        except ValueError:
            return m.group(0)
    return re.sub(r"\\u([0-9a-fA-F]{4})", _repl, text)


def render(m: folium.Map) -> str:
    """Render the map to HTML and decode JS Unicode escapes."""
    return resolve_js_unicode(m.get_root().render())


@pytest.fixture
def base_map() -> folium.Map:
    """Provide a fresh map for each test."""
    return folium.Map(location=[26.08, 119.30], zoom_start=12)


@pytest.fixture
def rendered(base_map: folium.Map) -> str:
    """Render a map (after adding controls) to HTML."""
    # Controls should be added to base_map before using this fixture
    return render(base_map)
