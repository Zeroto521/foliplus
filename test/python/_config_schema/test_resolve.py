"""Tests for tag resolution (``foliplus._config_schema.resolve``)."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Annotated, Any

import pytest

from foliplus import (
    BaseControl,
    ExportControl,
    FullscreenControl,
    HeatmapControl,
    LayerControl,
    LocateControl,
    MeasureControl,
    ScaleControl,
    SearchControl,
)
from foliplus._config_schema import (
    SHARED,
    UNSET,
    FieldSpec,
    config_fields,
    derive_schema,
    derived_control_schemas,
    render_ts_type,
    schema_to_json,
    validate_shape,
)

from .helper import (
    CONTROL_CLASSES,
    _default_literal,
    _derived,
    _js_files,
    _py_control_field_sets,
    _read_committed_fixture_defaults,
    _schema_defaults,
    _schema_dict,
    _spec_dict,
    _ts_interface_fields,
    _ts_short_to_control,
    _walk_specs,
)

class TestSchemaTypes:
    """FieldSpec must render to a valid TS type and the tag must be known."""

    def test_all_shared_and_control_specs_render(self) -> None:
        specs: list[tuple[str, FieldSpec]] = []
        for name, field in SHARED.items():
            specs.append((f"SHARED.{name}", field))

        for name in CONTROL_CLASSES:
            for field_name, field in _derived(name).items():
                specs.append((f"{name}.{field_name}", field))
        for where, spec in specs:
            try:
                ts = render_ts_type(spec)
            except ValueError as exc:
                pytest.fail(f"{where} rendered with error: {exc}")
            assert ts, f"{where} rendered to empty TS type"
