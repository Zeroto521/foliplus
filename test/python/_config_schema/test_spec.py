"""Tests for the field-spec model (``foliplus._config_schema.spec``)."""

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

class TestFieldSpecValidation:
    """FieldSpec rejects contradictory declarations at construction time.

    These guards are what keep the schema table honest: a typo'd tag or a
    flag pair that cannot both be true would otherwise render into the
    generated TS and only fail (if at all) in the browser.
    """

    def test_union_requires_values(self) -> None:
        with pytest.raises(ValueError, match="requires values"):
            FieldSpec("union")

    def test_union_rejects_empty_values(self) -> None:
        with pytest.raises(ValueError, match="requires values"):
            FieldSpec("union", values=())

    def test_unknown_tag_is_rejected(self) -> None:
        with pytest.raises(ValueError, match="not a supported tag"):
            FieldSpec("bogus")

    def test_metadata_only_field_spec_has_no_tag(self) -> None:
        # A FieldSpec carrying only a note (or nullable/optional) decides no
        # tag — the reflector does. ``ts=""`` is the "no override" sentinel
        # and must not be rejected as an unknown tag.
        spec = FieldSpec(ts="", note="just a note")
        assert spec.ts == ""

    def test_render_ts_type_rejects_unknown_tag(self) -> None:
        # __post_init__ covers typos at construction time; the render-time
        # guard catches specs that bypass the constructor (setattr on a
        # frozen dataclass, unpickling, third-party builders).
        spec = FieldSpec("string")
        object.__setattr__(spec, "ts", "bogus")
        with pytest.raises(ValueError, match="unknown FieldSpec.ts"):
            render_ts_type(spec)
