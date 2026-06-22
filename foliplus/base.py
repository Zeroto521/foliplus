from __future__ import annotations

from pathlib import Path
from textwrap import dedent
from typing import Optional

from folium import MacroElement
from folium.elements import JSCSSMixin
from jinja2 import Template

from .locale import EN, LocaleConfig

src_dir = Path(__file__).parent
js_dir = src_dir / "js"
css_dir = src_dir / "css"


class BaseControl(JSCSSMixin, MacroElement):
    """Base class for all foliplus controls.

    Handles resource loading (CSS/JS), template injection, and localization.
    """

    _tokens = css_dir.joinpath("shared-tokens.css").read_text(encoding="utf-8")
    _panel = css_dir.joinpath("shared-panel.css").read_text(encoding="utf-8")
    _shared = js_dir.joinpath("shared.js").read_text(encoding="utf-8")

    def __init__(
        self,
        position: str = "topleft",
        locale: Optional[LocaleConfig] = None,
    ):
        super().__init__()
        self._name = self.__class__.__name__
        self.position = position
        self.locale = locale or EN

    def _get_css(self, filename: str) -> str:
        return css_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_js(self, filename: str) -> str:
        return js_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_template(
        self,
        css_file: Optional[str] = None,
        js_file: Optional[str] = None,
        use_panel: bool = False,
    ) -> Template:
        """Build a Jinja2 template with shared CSS/JS + component assets."""
        css_content = self._get_css(css_file) if css_file else ""
        js_content = self._get_js(js_file) if js_file else ""
        panel_css = self._panel if use_panel else ""
        locale_table = self.locale.get_js_table()

        return Template(
            dedent(f"""\
            {{% macro html(this, kwargs) %}}
            <style>
            {self._tokens}
            {panel_css}
            {css_content}
            </style>
            {{% endmacro %}}

            {{% macro script(this, kwargs) %}}
            var _LOCALE = window._LOCALE || {locale_table};
            {self._shared}
            {js_content}
            {{% endmacro %}}""")
        )
