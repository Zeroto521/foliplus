"""Tests for foliplus.StyleKitControl."""

from __future__ import annotations

import re

import folium
from conftest import (
    assert_config_value,
    assert_locale,
    make_browser_page,
    read_css,
    render_control,
    use_page,
)

from foliplus import StyleKitControl


class TestStyleKitControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert StyleKitControl()._name == "StyleKitControl"

    def test_default_position(self):
        assert StyleKitControl().position == "bottomright"

    def test_custom_position(self):
        assert StyleKitControl(position="topleft").position == "topleft"

    def test_default_locale(self):
        assert StyleKitControl()._locale_code == ""

    def test_custom_locale(self):
        assert StyleKitControl(locale="zh")._locale_code == "zh"

    def test_no_cdn_dependencies(self):
        """The control ships with the shared runtime only."""
        assert StyleKitControl().default_js == []


class TestStyleKitControlRendering:
    """Rendering output tests (stable across minification)."""

    def test_rendered_content(self):
        """The control renders with its stylesheet and bundle injected."""
        html = render_control(StyleKitControl())
        assert "foliplus-stylekit-ctrl" in html
        assert "<style>" in html
        assert "StyleKitControl" in html

    def test_default_position_config(self):
        """The shared name/position pair is the only control-specific config."""
        html = render_control(StyleKitControl())
        assert_config_value(html, "position", "bottomright")

    def test_custom_position_config(self):
        assert_config_value(
            render_control(StyleKitControl(position="topleft")), "position", "topleft"
        )

    def test_layout_only_css(self):
        """The stylesheet supplies layout and text alignment only — the button
        recipe, the panel chrome and the icon stroke all stay with the shared
        `common/` stylesheets. A local redefinition of either would drift from
        the four other panel controls.
        """
        css = re.sub(
            r"/\*.*?\*/", "", read_css("foliplus/css/StyleKitControl.css"), flags=re.S
        )
        assert ".foliplus-panel-btn" not in css
        assert ".stylekit-action" in css
        assert "stroke" not in css
        assert "color" not in css

    def test_locale_zh(self):
        html = render_control(StyleKitControl(locale="zh"))
        assert_locale(html, "恢复默认", "StyleKitControl.restore_defaults")

    def test_locale_en(self):
        html = render_control(StyleKitControl(locale="en"))
        assert_locale(html, "Restore defaults", "StyleKitControl.restore_defaults")


class TestStyleKitControlBrowser:
    """Browser-based smoke tests for StyleKitControl."""

    def _make_page(self, browser, tmp_path, prelude: str | None = None):
        """Build a page with StyleKitControl and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        StyleKitControl().add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(
            browser, tmp_path, html, "stylekit", prelude=prelude
        )
        page.wait_for_selector(
            ".foliplus-stylekit-ctrl", state="attached", timeout=10000
        )
        return page, errors

    @staticmethod
    def _open_panel(page) -> None:
        """Expand the fold panel so its actions are clickable."""
        page.click(".foliplus-stylekit-ctrl .foliplus-toggle-btn")
        page.wait_for_selector(
            ".foliplus-stylekit-ctrl .stylekit-action", state="visible", timeout=5000
        )

    def test_panel_renders_both_actions(self, browser, tmp_path):
        """The panel carries exactly two actions, and no import placeholder.

        Saving a style record for later import is not part of this control;
        rendering a disabled placeholder would promise behaviour that does not
        exist, so the affordance is absent rather than greyed out.
        """
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            self._open_panel(page)
            labels = page.eval_on_selector_all(
                ".foliplus-stylekit-ctrl .stylekit-action",
                "els => els.map(e => e.textContent.trim())",
            )
            assert len(labels) == 2, f"expected 2 actions, got {labels!r}"
            assert not any("import" in label.lower() for label in labels)
            assert not errors, f"JS errors: {errors}"

    def test_restore_calls_the_setter_with_the_python_default(self, browser, tmp_path):
        """Restore writes each layer's setter back to its Python default."""
        prelude = """
            window.__stylekit = { calls: [] };
            window.__installStyleKitLayers = function () {
                window.map.foliplus.LayerAPI = {
                    layers: [
                        {
                            styleSetters: {
                                labelColor: v => window.__stylekit.calls.push(v),
                            },
                            styleDefaults: () => ({ labelColor: "#0000ff" }),
                        },
                        { name: "plain data layer", styleSetters: null },
                    ],
                };
            };
        """
        with use_page(self._make_page, browser, tmp_path, prelude=prelude) as (
            page,
            errors,
        ):
            self._open_panel(page)
            page.evaluate("__installStyleKitLayers()")
            page.click(".foliplus-stylekit-ctrl .stylekit-action:first-of-type")
            page.wait_for_selector(
                ".foliplus-hint-StyleKitControl", state="attached", timeout=5000
            )
            assert page.evaluate("__stylekit.calls") == ["#0000ff"]
            assert not errors, f"JS errors: {errors}"

    def test_reset_clears_only_this_maps_records(self, browser, tmp_path):
        """Reset drops this map container's foliplus records, nothing else."""
        prelude = """
            window.localStorage.setItem("foliplus_layer_state_other-map", "{}");
            window.localStorage.setItem("unrelated.setting", "1");
        """
        with use_page(self._make_page, browser, tmp_path, prelude=prelude) as (
            page,
            errors,
        ):
            self._open_panel(page)
            container_id = page.evaluate(
                "() => { const id = window.map.getContainer().id;"
                ' localStorage.setItem(`foliplus_layer_state_${id}`, "{}");'
                ' localStorage.setItem(`foliplus_measure_${id}`, "{}");'
                " return id; }"
            )
            page.click(".foliplus-stylekit-ctrl .stylekit-action:last-of-type")
            page.wait_for_selector(
                ".foliplus-hint-StyleKitControl", state="attached", timeout=5000
            )
            remaining = page.evaluate(
                "() => { const out = {};"
                " for (let i = 0; i < localStorage.length; i++) {"
                "   const k = localStorage.key(i); out[k] = localStorage.getItem(k);"
                " } return out; }"
            )
            assert f"foliplus_layer_state_{container_id}" not in remaining
            assert f"foliplus_measure_{container_id}" not in remaining
            assert remaining["foliplus_layer_state_other-map"] == "{}"
            assert remaining["unrelated.setting"] == "1"
            assert not errors, f"JS errors: {errors}"
