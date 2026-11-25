"""CSS contract: rules that mean "any row" select on the row identity class.

.foliplus-row is the single identity every row kind (layer / folder / group /
role header) carries. A rule that means "any row" but selects on
.foliplus-layer-item alone silently misses the role header — the exact bug
that left the role more-btn unpainted while the layer more-btn woke to accent
on hover / active.
"""

from __future__ import annotations

import re

import pytest

from conftest import read_css


LAYER_ITEM = ".foliplus-layer-item"
ROW = ".foliplus-row"

# Selectors that genuinely mean "a layer row": base basemap quiet, folder /
# group label weight, the layer item's own grid, renaming. These may select on
# LAYER_ITEM.
_LAYER_ONLY_CONTEXTS = (
    "data-layer-type",
    "foliplus-layer-item-folder",
    "foliplus-layer-item-group",
    "foliplus-layer-renaming",
    "foliplus-layer-group-folded",
    # The layer row's own grid block: role header uses a different grid, so
    # this bare selector is legitimately layer-only.
    ".foliplus-layer-item {",
)


def _flat(css: str) -> str:
    # Comments are prose, not selectors: a stale ".foliplus-layer-item" in a
    # comment must not trip the guard.
    return re.sub(r"\s+", " ", re.sub(r"/\*.*?\*/", "", css, flags=re.S))


@pytest.mark.parametrize(
    "path",
    [
        "foliplus/css/control/LayerControl/row.css",
        "foliplus/css/control/LayerControl/menu.css",
        "foliplus/css/control/LayerControl/control.css",
    ],
)
def test_row_level_rules_use_identity_class(path: str):
    """Every "any row" rule selects on .foliplus-row, not LAYER_ITEM alone."""
    css = read_css(path)
    flat = _flat(css)
    for match in re.finditer(r"[^{}]*\.foliplus-layer-item[^{}]*\{", flat):
        selector = match.group(0)
        if any(ctx in selector for ctx in _LAYER_ONLY_CONTEXTS):
            continue
        # A selector that also lists .foliplus-row or another row kind (the
        # role header, the toggle-all row) is fine; a bare LAYER_ITEM selector
        # is the regression.
        assert ROW in selector or "foliplus-layer-role" in selector or "foliplus-layer-sep" in selector, (
            f"{path}: a row-level rule selects on {LAYER_ITEM} alone and will "
            f"miss the role header: {selector.strip()[:120]}"
        )
