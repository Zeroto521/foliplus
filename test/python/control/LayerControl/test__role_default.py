"""The central role-defaults declaration: normalise_role_defaults.

The author passes ``roles={"overlay": {"folded": True}, ...}`` to
``LayerControl``; this module normalises it into the CONF contract the JS
side reads. These tests pin the verdict rules: a malformed declaration warns
once and is ignored (never raises, never hides data), an unknown role is
rejected, a non-bool ``folded`` is treated as expanded, and the returned
mapping always carries both sections.
"""

from __future__ import annotations

import pytest

from foliplus.control.LayerControl._role_default import normalise_role_defaults


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
