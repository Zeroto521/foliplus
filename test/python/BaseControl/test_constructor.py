"""Tests for foliplus.BaseControl — the Python ↔ JS bridge layer.

Boundary rule: this file only verifies the PY↔JS bridge — shared CSS/JS assets
injection, locale table injection, shared-resource deduplication, and the
escaping of model data serialized into the inline ``<script>`` tags. JS
function presence and internal logic are covered by test/js/ unit tests.
"""

from __future__ import annotations

import json

import folium
import pytest
from conftest import assert_config_block, render_control


class TestBaseControlPython:
    """Python-side API tests for BaseControl internals."""

    def test_config_fields_defaults_to_empty(self):
        from foliplus.BaseControl import BaseControl

        assert BaseControl._config_fields == ()

    def test_extra_config_defaults_to_empty(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        assert ctrl._extra_config() == {}

    def test_template_defaults_to_class_cache(self, monkeypatch):
        """Without an instance override the property returns the class-cached template."""
        import importlib

        from jinja2 import Template

        from foliplus import BaseControl

        # `from foliplus import BaseControl` re-binds the class, but the
        # module-level function lives on the real submodule — the property
        # calls the module-global, so the patch has to target it.
        base_control_module = importlib.import_module("foliplus.BaseControl")
        cached = Template("cached template")
        monkeypatch.setattr(
            base_control_module, "_build_component_template", lambda name: cached
        )
        ctrl = BaseControl()
        assert ctrl._template is cached

    def test_template_instance_assignment_wins(self):
        """An explicit per-instance ``_template`` is returned over the class cache."""
        from jinja2 import Template

        from foliplus import BaseControl

        ctrl = BaseControl()
        sentinel = Template("{{ sentinel }}")
        ctrl._template = sentinel
        assert ctrl._template is sentinel

    def test_build_config_includes_shared_keys(self):
        from foliplus.BaseControl import BaseControl

        assert_config_block(
            BaseControl(), {"name": "BaseControl", "position": "topleft"}
        )

    def test_invalid_position_raises(self):
        """An unknown position is rejected instead of silently falling back."""
        from foliplus.BaseControl import BaseControl

        with pytest.raises(ValueError, match="position must be one of"):
            BaseControl(position="center")

    def test_every_position_is_accepted(self):
        from foliplus.BaseControl import BaseControl

        for position in ("topleft", "topright", "bottomleft", "bottomright"):
            assert BaseControl(position=position).position == position

    def test_build_config_caches_on_self_config(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        config = ctrl._build_config()
        assert ctrl._config is config

    def test_build_config_missing_export_field_raises(self):
        """If _config_fields names an attribute that doesn't exist, _build_config raises."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _config_fields = ("nonexistent",)

        ctrl = BadControl()
        with pytest.raises(ValueError, match=r"nonexistent"):
            ctrl._build_config()

    def test_build_config_missing_export_field_names_control(self):
        """The error message names the declaring control and the offending field."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _config_fields = ("typo",)

        ctrl = BadControl()
        with pytest.raises(ValueError) as exc:
            ctrl._build_config()
        assert "BadControl" in str(exc.value)
        assert "'typo'" in str(exc.value)

    def test_build_config_missing_export_field_fails_fast(self):
        """Only the first missing field is reported; validation stops there."""
        from foliplus.BaseControl import BaseControl

        class BadControl(BaseControl):
            _config_fields = ("alpha", "beta")

        ctrl = BadControl()
        with pytest.raises(ValueError) as exc:
            ctrl._build_config()
        assert "'alpha'" in str(exc.value)
        assert "'beta'" not in str(exc.value)

    def test_build_config_allows_none_value_export_field(self):
        """An exported field may legitimately be None."""
        from foliplus.BaseControl import BaseControl

        class NullControl(BaseControl):
            _config_fields = ("nullable",)

            def __init__(self):
                super().__init__()
                self.nullable = None

        assert_config_block(NullControl(), {"nullable": None})

    def test_build_config_field_set_in_subclass_init(self):
        """Validation passes when _config_fields fields are set after super().__init__."""
        from foliplus.BaseControl import BaseControl

        class LateControl(BaseControl):
            _config_fields = ("late_value",)

            def __init__(self):
                super().__init__()
                self.late_value = 42

        assert_config_block(LateControl(), {"late_value": 42})

    def test_config_block_includes_locale_tables(self, base_map: folium.Map):
        from foliplus import SearchControl

        html = render_control(SearchControl(locale="en"))
        assert '"locale_code": "en"' in html
        assert '"locale_tables"' in html

    def test_config_block_does_not_pollute_config_cache(self):
        """_config_block copies _build_config before adding locale overlay."""
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        _ = ctrl._config_block
        assert "locale_tables" not in ctrl._config
        assert "locale_code" not in ctrl._config

    def test_config_fields_are_serialized_in_config(self):
        from foliplus import FullscreenControl

        assert_config_block(
            FullscreenControl(hide_self=False, hide_others=True),
            {"hide_self": False, "hide_others": True},
        )

    def test_extra_config_merged_into_build_config(self):
        import folium

        from foliplus import LayerControl

        m = folium.Map()
        ctrl = LayerControl()
        m.add_child(ctrl)
        config = ctrl._build_config()
        assert "data" in config
        assert isinstance(config["data"], list)

    def test_config_fields_shared_keys_extra_config_merge_order(self):
        """_build_config merge order: shared keys → export fields → extra_config.
        Later wins on conflicts."""
        from foliplus.BaseControl import BaseControl

        class OverrideControl(BaseControl):
            _config_fields = ("position",)

            def __init__(self):
                super().__init__(position="topleft")
                self.position = "overridden_by_export"

            def _extra_config(self):
                return {"position": "overridden_by_extra"}

        assert_config_block(OverrideControl(), {"position": "overridden_by_extra"})

    def test_default_locale_code_empty(self):
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        assert ctrl._locale_code == ""

    def test_config_block_parses(self):
        """_config_block returns valid JSON with expected keys."""
        from foliplus.BaseControl import BaseControl

        ctrl = BaseControl()
        parsed = json.loads(ctrl._config_block)
        assert parsed["name"] == "BaseControl"
        assert parsed["position"] == "topleft"
        assert "locale_tables" in parsed
        assert "locale_code" in parsed
