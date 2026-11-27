"""CSS contract: rules that mean "any row" select on the row identity class.

.foliplus-row is the single identity every row kind (layer / folder / group /
role header) carries. Before it existed, a rule meaning "any row" had to
enumerate row kinds by hand, and every enumeration missed the role header —
the bug that left the role more-btn unpainted while the layer more-btn woke to
accent on hover / active.

Two invariants are pinned here:

1. A selector leg that means "any row" selects on .foliplus-row, never on
   .foliplus-layer-item alone.
2. The role header is never re-listed beside .foliplus-row. It carries the
   identity class now, so naming its own compound as a second leg is a second
   identity path — and a specificity asymmetry: the `:is()` form listed with it
   takes its MOST specific argument for EVERY row, which silently out-ranked
   rules that were meant to win (the map-focus highlight lost to the
   checked-row wash because of exactly that).
"""

from __future__ import annotations

import re

import pytest
from conftest import read_css

LAYER_ITEM = ".foliplus-layer-item"
ROW = ".foliplus-row"
ROLE_COMPOUND = ".foliplus-layer-sep.foliplus-layer-toggle-all"

# Selector legs that genuinely mean "a layer row": base basemap quiet, folder /
# group label weight, renaming.
_LAYER_ONLY_CONTEXTS = (
    "data-layer-type",
    "foliplus-layer-item-folder",
    "foliplus-layer-item-group",
    "foliplus-layer-renaming",
    "foliplus-layer-group-folded",
)


def _rules(css: str) -> list[tuple[str, str]]:
    """Return (selector list, declarations) for every block in a nested sheet.

    The sheet is authored with nesting, so a block's selector is the text
    between the previous `{`, `}` or `;` and its own `{`; declarations run to
    the matching close brace. Comments are stripped first — prose is not a
    selector.

    This is a heuristic, not a parser: it assumes a selector carries no literal
    `{`, `}` or `;`. That holds for the three sheets this guard reads (row.css,
    menu.css, control.css — no data-URI, no custom-property value in a
    selector). A stylesheet that ever puts one there needs a real parser; the
    failure mode is a garbled selector, which surfaces as a confusing assertion
    rather than a silent pass.
    """
    text = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    rules: list[tuple[str, str]] = []
    for match in re.finditer(r"\{", text):
        open_at = match.start()
        boundary = max(
            text.rfind("{", 0, open_at),
            text.rfind("}", 0, open_at),
            text.rfind(";", 0, open_at),
        )
        selector = re.sub(r"\s+", " ", text[boundary + 1 : open_at]).strip()
        if not selector:
            continue
        depth = 0
        close_at = len(text) - 1
        for index in range(open_at, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    close_at = index
                    break
        rules.append((selector, text[open_at + 1 : close_at]))
    return rules


def _has_class(selector: str, class_name: str) -> bool:
    """True when the selector names exactly that class.

    A plain substring test would match ".foliplus-row-panel" for
    ".foliplus-row" — the row panel's own class, which is not a row identity —
    and ".foliplus-layer-toggle-all-extra" for ROLE_COMPOUND. The lookahead
    rejects a class that continues with a word character or a hyphen.

    No lookbehind for the same reason, and none is needed: every class name the
    guard compares starts with a dot and the repo namespace prefix
    (`.foliplus-`), so a "prefix-polluted" class such as `x-foliplus-row` is a
    different string that never matches. Only trailing growth is a real hazard.
    """
    return re.search(re.escape(class_name) + r"(?![\w-])", selector) is not None


def _selector_legs(selector_list: str) -> list[str]:
    """Split a selector list on its TOP-LEVEL commas.

    A comma inside :is()/:has() belongs to one leg: splitting there would make
    every :is() list look like enumerated row kinds.
    """
    legs: list[str] = []
    depth = 0
    current = ""
    for char in selector_list:
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        if char == "," and depth == 0:
            legs.append(current)
            current = ""
            continue
        current += char
    legs.append(current)
    return [leg.strip() for leg in legs if leg.strip()]


@pytest.mark.parametrize(
    "path",
    [
        "foliplus/css/control/LayerControl/row.css",
        "foliplus/css/control/LayerControl/menu.css",
        "foliplus/css/control/LayerControl/control.css",
    ],
)
def test_row_level_rules_use_identity_class(path: str):
    """Every "any row" selector leg selects on .foliplus-row, not LAYER_ITEM."""
    for selector_list, _declarations in _rules(read_css(path)):
        for leg in _selector_legs(selector_list):
            if LAYER_ITEM not in leg:
                continue
            if any(ctx in leg for ctx in _LAYER_ONLY_CONTEXTS):
                continue
            # The layer item's own grid block: the role header has a different
            # grid, so a bare LAYER_ITEM selector is legitimately layer-only.
            if leg == LAYER_ITEM:
                continue
            # The identity class is the ONLY accepted spelling for "any row".
            # An enumerated alternative is the shape this guard exists to stop:
            # listing row kinds by hand silently misses whichever kind is added
            # next.
            assert _has_class(leg, ROW), (
                f"{path}: a row-level selector leg selects on {LAYER_ITEM} "
                f"alone and will miss the role header: {leg[:120]}"
            )


def test_has_class_rejects_a_longer_class_sharing_the_prefix():
    """The helper both rules lean on must not match by prefix.

    Every rule in this file is only as good as this predicate: a substring test
    would silently exempt `.foliplus-row-panel` (the panel's own class) or a
    future `.foliplus-layer-toggle-all-extra` from the invariant.
    """
    assert _has_class(ROW, ROW)
    assert _has_class(f".foliplus-layer-ctrl {ROW}:focus-visible", ROW)
    assert not _has_class(f"{ROW}-panel", ROW)
    assert not _has_class(f".foliplus-drag{ROW[1:]}", ROW)
    assert _has_class(f"{ROLE_COMPOUND}:hover", ROLE_COMPOUND)
    assert not _has_class(f"{ROLE_COMPOUND}-extra", ROLE_COMPOUND)


@pytest.mark.parametrize(
    "path",
    [
        "foliplus/css/control/LayerControl/row.css",
        "foliplus/css/control/LayerControl/menu.css",
        "foliplus/css/control/LayerControl/control.css",
    ],
)
def test_role_header_is_never_relisted_beside_the_identity(path: str):
    """The role compound may not be a second leg of a .foliplus-row rule."""
    for selector_list, _declarations in _rules(read_css(path)):
        legs = _selector_legs(selector_list)
        row_legs = [leg for leg in legs if _has_class(leg, ROW)]
        if not row_legs:
            continue
        for leg in row_legs:
            assert not _has_class(leg, ROLE_COMPOUND), (
                f"{path}: the role header carries .foliplus-row, so listing "
                f"{ROLE_COMPOUND} beside it is a second identity path (and an "
                f":is() specificity inflation for every row): {leg[:140]}"
            )
        re_listed = [leg for leg in legs if _has_class(leg, ROLE_COMPOUND)]
        assert not re_listed, (
            f"{path}: {ROLE_COMPOUND} is listed as an alternative to "
            f".foliplus-row in one selector list — the role header already "
            f"matches the identity class: {selector_list[:140]}"
        )
