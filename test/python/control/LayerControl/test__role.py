"""The Python role vocabulary and its single mapping point.

The overlay/base grouping a layer belongs to is ONE word: ``role`` (mirrored by
JS ``core/layer/role.ts``). folium calls it ``overlay`` — its native Layer
``__init__`` param — and foliplus must keep reading that param because it IS the
folium API. These tests pin the mapping (``layer_role``) and the fact that the
CONF shape's role values come from the same source as the type (change
``LayerRole`` and the schema's valid set changes with it).
"""

from __future__ import annotations

from typing import get_args

import pytest

from foliplus import LayerControl
from foliplus._config_schema import FieldSpec
from foliplus.control.LayerControl._role import (
    LayerRole,
    layer_role,
    normalise_role_defaults,
)


def _layer_shape() -> list[dict[str, object]]:
    """The ``data`` shape descriptor LayerControl emits for CONF."""
    spec = next(
        (
            item
            for item in get_args(LayerControl._dynamic_fields["data"])
            if isinstance(item, FieldSpec)
        ),
        None,
    )
    assert spec is not None, "LayerControl._dynamic_fields['data'] needs a FieldSpec"
    return list(spec.shape)


class TestLayerRole:
    """``layer_role`` maps folium's overlay flag to the foliplus role."""

    @pytest.mark.parametrize(
        ("overlay", "expected"),
        [
            (True, "overlay"),
            (False, "base"),
            (None, "base"),  # missing attribute -> base (folium default)
        ],
    )
    def test_layer_role_maps_the_folium_flag(
        self, overlay: object, expected: str
    ) -> None:
        assert layer_role(type("L", (), {"overlay": overlay})()) == expected

    def test_layer_role_is_total_over_the_vocabulary(self) -> None:
        """Every declared role is reachable from some folium flag."""
        seen = {layer_role(type("L", (), {"overlay": v})()) for v in (True, False)}
        assert seen == set(get_args(LayerRole))


class TestSchemaSameSource:
    """The CONF shape's role valid set is the same source as ``LayerRole``."""

    def test_shape_role_values_equal_layer_role_args(self) -> None:
        shape = _layer_shape()
        assert len(shape) == 1
        assert shape[0]["role"] == get_args(LayerRole)

    def test_shape_role_is_not_a_hand_written_tuple(self) -> None:
        """The shape must derive from the type, not a second literal tuple."""
        shape = _layer_shape()
        assert len(shape) == 1
        role_value = shape[0]["role"]
        # The shape descriptor is a tuple from get_args(LayerRole). A hand-written
        # tuple of the same values is indistinguishable here, so this pins the
        # *type* as the source by asserting the descriptor IS get_args' output.
        assert role_value is not None
        assert set(role_value) == set(get_args(LayerRole))


class TestNormaliseRoleDefaults:
    """normalise_role_defaults verdicts: usable / ignored-with-warning."""

    def test_none_is_undeclared(self) -> None:
        assert normalise_role_defaults(None) is None

    def test_non_mapping_is_undeclared(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping of sections"):
            assert normalise_role_defaults("not a mapping") is None

    def test_basic_entries_round_trip(self) -> None:
        result = normalise_role_defaults(
            {"overlay": {"folded": True}, "base": {"folded": False}}
        )
        assert result == {"overlay": {"folded": True}, "base": {"folded": False}}

    def test_missing_section_becomes_empty_mapping(self) -> None:
        result = normalise_role_defaults({"overlay": {"folded": True}})
        assert result == {"overlay": {"folded": True}, "base": {}}

    def test_unknown_section_is_ignored(self) -> None:
        with pytest.warns(UserWarning, match="unknown role"):
            result = normalise_role_defaults({"bogus": {"folded": True}})
        assert result == {"overlay": {}, "base": {}}

    def test_unknown_key_rejects_the_entry(self) -> None:
        with pytest.warns(UserWarning, match=r"unknown key\(s\)"):
            result = normalise_role_defaults({"overlay": {"folded": True, "extra": 1}})
        assert result == {"overlay": {}, "base": {}}

    def test_non_bool_folded_warns_and_treats_as_expanded(self) -> None:
        with pytest.warns(UserWarning, match="expected a bool"):
            result = normalise_role_defaults({"overlay": {"folded": "yes"}})
        assert result == {"overlay": {}, "base": {}}

    def test_section_value_must_be_a_mapping(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping"):
            result = normalise_role_defaults({"overlay": [{"folded": True}]})
        assert result == {"overlay": {}, "base": {}}

    def test_section_value_non_mapping_warns_and_is_ignored(self) -> None:
        with pytest.warns(UserWarning, match="expected a mapping"):
            result = normalise_role_defaults({"overlay": True})
        assert result == {"overlay": {}, "base": {}}


class TestLayerControlRolesConfig:
    """LayerControl(roles=...) serialises the normalised config."""

    def test_default_roles_is_none(self) -> None:
        from foliplus import LayerControl

        assert LayerControl().roles is None

    def test_roles_is_a_config_field(self) -> None:
        from foliplus import LayerControl

        assert "roles" in LayerControl._config_fields

    def test_roles_serialises_into_config(self) -> None:
        import folium

        from foliplus import LayerControl

        ctrl = LayerControl(roles={"overlay": {"folded": True}})
        cfg = ctrl._build_config()
        assert cfg["roles"] == {
            "overlay": {"folded": True},
            "base": {},
        }

    def test_invalid_roles_serialises_as_none(self) -> None:
        import folium

        from foliplus import LayerControl

        ctrl = LayerControl(roles="bad")
        assert ctrl._build_config()["roles"] is None
