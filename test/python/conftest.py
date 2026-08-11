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
import re
from collections.abc import Generator
from pathlib import Path
from typing import TYPE_CHECKING, Any

import folium
import pytest

if TYPE_CHECKING:
    from playwright.sync_api import Browser


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


def assert_css_token(html: str, token: str) -> None:
    """Assert that a CSS custom property or class name is present."""
    assert token in html, f"Expected CSS token {token!r} not found in rendered HTML"


def assert_config_block(ctrl, expected: dict[str, Any]) -> None:
    """Assert that ``ctrl._build_config()`` contains the expected values.

    Only checks keys present in *expected*; extra keys are ignored.
    """
    config = ctrl._build_config()
    for key, value in expected.items():
        assert config.get(key) == value, (
            f"Expected config[{key!r}] = {value!r}, got {config.get(key)!r}"
        )


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
    html_path.write_text(html, encoding="utf-8")
    page = browser.new_page()
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


# ── Fixtures ──


def pytest_collection_modifyitems(config, items):
    """Auto-mark test classes ending with 'Browser' as pytest.mark.browser."""
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

    Skipped if Playwright is not installed::

        pip install playwright
        playwright install chromium
    """
    pytest.importorskip("playwright")
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        yield browser
        browser.close()
