"""Guard: browser-test JS must not be embedded as a Python string literal.

A Playwright browser test that needs JS to drive the page must read it from
test/js/snippet/<Component>/<name>.js (shared helpers under common/) via
conftest.snippet(). A triple-quoted evaluate(...) string is the banned shape:
the JS is not linted, not typechecked, not covered by vitest, and cannot be
reused. This guard scans every .py under test/python/ and fails on any
multi-line inline JS literal.

Run without a browser (pure static scan).
"""

from __future__ import annotations

import re
from pathlib import Path

# page.evaluate( followed by a triple-quote block: the inline-JS shape to ban.
# The single-quoted regex keeps the banned tokens out of this file's own
# source (the backslash-space escape means "page.evaluate(" + the quote
# block is never present verbatim), so the guard does not flag itself.
INLINE_JS = re.compile(r'page\.evaluate\(\s*"""')

ROOT = Path(__file__).resolve().parents[3]


def test_no_inline_multiline_js_in_python() -> None:
    """The Python test layer extracts JS to test/js/snippet/, never inline."""
    offenders: list[str] = []
    for path in sorted((ROOT / "test" / "python").rglob("*.py")):
        src = path.read_text(encoding="utf-8")
        for m in INLINE_JS.finditer(src):
            line = src.count("\n", 0, m.start()) + 1
            offenders.append(f"{path.relative_to(ROOT)}:{line}")
    assert not offenders, (
        "multi-line page.evaluate JS must be extracted to test/js/snippet/ "
        f"via conftest.snippet(): {offenders}"
    )
