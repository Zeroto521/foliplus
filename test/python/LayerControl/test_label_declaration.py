"""The author-facing declaration key: `label`, with `annotation` as a

Deprecated alias.

A layer declares its label defaults on itself, not on the control, so this
is a pure Python bridge concern: the dict rides `layer.options.foliplus`
straight into the page, and the control only inspects it while collecting
layers to raise the migration hint once per process.
"""

from __future__ import annotations

import importlib
import json
import warnings

import folium
import pytest

from foliplus import LayerControl

_EMPTY = json.dumps({"type": "FeatureCollection", "features": []})


def _render_config(declaration: dict[str, object]) -> dict[str, object]:
    """Build a control whose layer declares *declaration*, then collect."""
    m = folium.Map()
    ctrl = LayerControl().add_to(m)
    folium.GeoJson(_EMPTY, name="declared", foliplus=declaration).add_to(ctrl)
    return ctrl._extra_config()  # type: ignore[attr-defined]


@pytest.fixture(autouse=True)
def _fresh_warning_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    """The flag is process-wide by design, so tests reset it explicitly."""
    # The package re-exports the class under the module's name, so resolve
    # the module object instead of letting a dotted string land on the class.
    module = importlib.import_module("foliplus.LayerControl")
    monkeypatch.setattr(module, "_ANNOTATION_KEY_WARNED", False)


def _deprecations(caught: list[warnings.WarningMessage]) -> list[str]:
    return [
        str(w.message) for w in caught if issubclass(w.category, DeprecationWarning)
    ]


def test_label_key_raises_no_warning() -> None:
    """The current key is the quiet path."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        data = _render_config({"label": {"field": "name"}})
    assert _deprecations(caught) == []
    assert data["data"][0]["name"] == "declared"


def test_annotation_key_warns_once_per_process() -> None:
    """One hint for the whole process, however often a control renders."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        _render_config({"annotation": {"field": "name"}})
        _render_config({"annotation": {"field": "other"}})
    messages = _deprecations(caught)
    assert len(messages) == 1
    assert "deprecated" in messages[0]
    assert 'foliplus={"label": ...}' in messages[0]


def test_label_wins_when_both_keys_are_present() -> None:
    """Declaring both is a migration in progress, not a deprecation."""
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        _render_config({"label": {"field": "new"}, "annotation": {"field": "old"}})
    assert _deprecations(caught) == []
