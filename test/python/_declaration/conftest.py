"""Process-wide diagnostic stores are isolated per test in this directory."""

from __future__ import annotations

import pytest

from foliplus import _declaration


@pytest.fixture(autouse=True)
def _fresh_report_filters() -> None:
    """Isolate the process-wide diagnostic stores between tests."""
    _declaration.foliplus_reports.clear()
    _declaration.refused_captions.clear()
    yield
    _declaration.foliplus_reports.clear()
    _declaration.refused_captions.clear()
