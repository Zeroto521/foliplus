from __future__ import annotations

from json import dumps
from pathlib import Path
from textwrap import dedent

from branca.element import Element, Figure
from folium import MacroElement
from folium.elements import JSCSSMixin
from jinja2 import Template

from ._typing import Position
from .locale import _LOCALES_TABLES, LocaleConfig, resolve_locale

src_dir = Path(__file__).parent
js_dir = src_dir / "js"
css_dir = src_dir / "css"

# Stable child name used to deduplicate the shared asset bundle in a figure's
# header, so runtime.js / common.css / locale tables are emitted only once per map.
_SHARED_ASSETS_NAME = "foliplus_shared"


class BaseControl(JSCSSMixin, MacroElement):
    """Base class for all foliplus controls.

    Handles resource loading (CSS/JS), template injection, and localization. All
    foliplus components (FullscreenControl, HeatmapControl, LayerControl, etc.) inherit
    from this class.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance.
        If omitted, the browser's ``navigator.language`` is used at runtime to
        select the appropriate locale table, falling back to English.
    """

    _common = css_dir.joinpath("common.css").read_text(encoding="utf-8")
    _panel = css_dir.joinpath("panel.css").read_text(encoding="utf-8")
    _runtime = js_dir.joinpath("runtime.js").read_text(encoding="utf-8")

    # Shared asset bundle injected once per map (see ``render``). Contains the
    # common + panel CSS, the runtime JS namespace, and every locale table. Built
    # once at import time and reused across all controls and maps.
    _shared_header = (
        "<style>\n"
        f"{_common}\n{_panel}\n"
        "</style>\n"
        "<script>\n"
        f"{_runtime}\n"
        "window.foliplus = window.foliplus || {};\n"
        f"window.foliplus._TABLES = {dumps(_LOCALES_TABLES, ensure_ascii=False)};\n"
        "</script>"
    )

    def __init__(
        self,
        *,
        position: Position = "topleft",
        locale: str | LocaleConfig | None = None,
    ):
        super().__init__()
        self._name = self.__class__.__name__
        self.position = position
        self._locale_code = resolve_locale(locale).code if locale is not None else ""

    def render(self, **kwargs):
        """Inject the shared asset bundle into the figure header exactly once.

        The runtime JS, shared CSS, and locale tables are identical for every
        control, so they are emitted a single time per map (deduplicated by
        :data:`_SHARED_ASSETS_NAME`) instead of being repeated in each control's
        template. Placing them in ``<head>`` also guarantees they load before any
        control's body script runs.
        """
        figure = self.get_root()
        if (
            isinstance(figure, Figure)
            and _SHARED_ASSETS_NAME not in figure.header._children
        ):
            figure.header.add_child(
                Element(self._shared_header), name=_SHARED_ASSETS_NAME
            )
        super().render(**kwargs)

    def _get_js(self, filename: str) -> str:
        return js_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_css(self, filename: str) -> str:
        return css_dir.joinpath(filename).read_text(encoding="utf-8")

    def _get_template(
        self,
        *,
        js_file: str | None = None,
        css_file: str | None = None,
    ) -> Template:
        """Build a Jinja2 template with this control's own CSS/JS.

        Shared assets (``common.css``, ``panel.css``, ``runtime.js``, and the
        locale tables) are injected once per map by :meth:`render`, so this
        template only carries the component-specific CSS/JS plus a small call to
        resolve the locale from the shared ``window.foliplus._TABLES``.

        Parameters
        ----------
        js_file : str, optional
            Component JS filename (e.g. ``"LayerControl.js"``).

        css_file : str, optional
            Component CSS filename (e.g. ``"LayerControl.css"``).

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        js = self._get_js(js_file) if js_file else ""
        css = self._get_css(css_file) if css_file else ""

        return Template(
            dedent(f"""\
            {{% macro html(this, kwargs) %}}
            <style>
            {css}
            </style>
            {{% endmacro %}}

            {{% macro script(this, kwargs) %}}
            if (window.foliplus && window.foliplus.resolveLocale) {{
                window.foliplus.resolveLocale({{{{ this._locale_code | tojson }}}}, window.foliplus._TABLES);
            }}
            {js}
            {{% endmacro %}}""")
        )
