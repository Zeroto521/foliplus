from __future__ import annotations

from pathlib import Path
from textwrap import dedent
from typing import Optional, Union

from folium import MacroElement
from folium.elements import JSCSSMixin
from jinja2 import Template

from ._cdn import GCOORD
from ._typing import Position
from .locale import LocaleConfig, resolve_locale

src_dir = Path(__file__).parent
js_dir = src_dir / "js"
css_dir = src_dir / "css"


class BaseControl(JSCSSMixin, MacroElement):
    """Base class for all foliplus controls.

    Handles resource loading (CSS/JS), template injection, and localization. All
    foliplus components (Fullscreen, HeatmapControl, LayerControl, etc.) inherit from
    this class.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        Defaults to auto-detection, falling back to English.
    """

    _common = css_dir.joinpath("common.css").read_text(encoding="utf-8")
    _panel = css_dir.joinpath("panel.css").read_text(encoding="utf-8")
    _runtime = js_dir.joinpath("runtime.js").read_text(encoding="utf-8")

    def __init__(
        self,
        position: Position = "topleft",
        locale: Optional[Union[str, LocaleConfig]] = None,
    ):
        super().__init__()
        self._name = self.__class__.__name__
        self.position = position
        self.locale = resolve_locale(locale)
        self._gcoord_version = GCOORD

    def _get_js(self, filename: str) -> str:
        return js_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_css(self, filename: str) -> str:
        return css_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_template(
        self,
        *,
        js_file: Optional[str] = None,
        css_file: Optional[str] = None,
        use_panel: bool = False,
    ) -> Template:
        """Build a Jinja2 template with shared CSS/JS + component assets.

        Injects ``common.css``, ``panel.css`` (if ``use_panel=True``), ``runtime.js``,
        and the specified component JS/CSS files into a Jinja2 macro pair
        (``html`` / ``script``) for folium's rendering pipeline.

        Parameters
        ----------
        js_file : str, optional
            Component JS filename (e.g. ``"LayerControl.js"``).
        css_file : str, optional
            Component CSS filename (e.g. ``"LayerControl.css"``).
        use_panel : bool, default False
            Whether to include shared panel CSS.

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        js_runtime = self._get_js(js_file) if js_file else ""
        css_common = self._get_css(css_file) if css_file else ""
        css_panel = self._panel if use_panel else ""
        locale_table = self.locale.get_js_table()

        return Template(
            dedent(f"""\
            {{% macro html(this, kwargs) %}}
            <style>
            {self._common}
            {css_panel}
            {css_common}
            </style>
            {{% endmacro %}}

            {{% macro script(this, kwargs) %}}
            var _LOCALE = window._LOCALE || {locale_table};
            {self._runtime}
            {js_runtime}
            {{% endmacro %}}""")
        )
