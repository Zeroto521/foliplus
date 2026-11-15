"""Guard tests for the fullscreen-stub injection helper.

The pseudo-fullscreen tests inject a stub that disables the native Fullscreen
API before the page scripts run. A naive ``str.replace("<body>", ...)`` replaces
EVERY ``<body>`` literal in the HTML — including one inside a JS comment in a
bundle — which injects a nested ``<script>`` into an inline bundle and breaks
it with ``Unexpected token '<'`` (the S1 filter comment regression). These
tests pin the anchored regex behaviour: only the real body open tag is hit.
"""

from __future__ import annotations

import pytest
from conftest import inject_fullscreen_stub


def test_stub_injects_once_at_real_body():
    """The stub is inserted exactly once, right after the real <body> tag."""
    html = '<html><head></head><body class="map-page"><script>var x = 1;</script></body></html>'
    out = inject_fullscreen_stub(html)
    assert out.count("fullscreenEnabled") == 1
    assert out.count("<body") == 1
    body_idx = out.index("<body")
    stub_idx = out.index("fullscreenEnabled")
    assert body_idx < stub_idx
    assert "var x = 1;" in out


def test_stub_leaves_body_literal_in_comment_alone():
    """A literal <body> inside a JS comment is NOT treated as the body tag."""
    html = "<html><head></head><body><script>// portaled to <body> here\nvar x = 1;</script></body></html>"
    out = inject_fullscreen_stub(html)
    assert "portaled to <body> here" in out
    assert out.count("fullscreenEnabled") == 1
    # The real body tag + the comment literal both survive.
    assert out.count("<body>") == 2


def test_stub_raises_without_body_tag():
    """A page without a <body> tag is a fixture error, not a silent pass."""
    with pytest.raises(ValueError, match="no <body> tag"):
        inject_fullscreen_stub("<html><head></head></html>")
