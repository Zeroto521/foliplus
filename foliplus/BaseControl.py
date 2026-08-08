from __future__ import annotations

from functools import cache
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
dist_dir = src_dir / "dist"

# Stable child name used to deduplicate the shared asset bundle in a figure's
# header, so runtime.js / common.css / locale tables are emitted only once per map.
_SHARED_ASSETS_NAME = "foliplus_shared"


@cache
def _load_shared_asset(src: Path, artifact: Path) -> str:
    """Load a shared asset, preferring the minified artifact."""
    if artifact.is_file():
        return artifact.read_text(encoding="utf-8")
    return src.read_text(encoding="utf-8")


@cache
def _build_shared_header() -> str:
    """Build the shared asset bundle (<style> + <script>) injected once per map.

    Contains common.css, panel.css, runtime.js (with runtime/*.js bundled in),
    and the locale tables. Built once and cached at module level.
    """
    common = _load_shared_asset(css_dir / "common.css", dist_dir / "common.min.css")
    panel = _load_shared_asset(css_dir / "panel.css", dist_dir / "panel.min.css")
    runtime = _load_shared_asset(
        js_dir / "runtime" / "runtime.js", dist_dir / "runtime.min.js"
    )
    return (
        "<style>\n"
        f"{common}\n{panel}\n"
        "</style>\n"
        "<script>\n"
        f"{runtime}\n"
        "window.foliplus = window.foliplus || {};\n"
        f"window.foliplus._TABLES = {dumps(_LOCALES_TABLES, ensure_ascii=False)};\n"
        "</script>"
    )


def _load_asset(src: Path, artifact: Path) -> str:
    """Read an asset, preferring the minified artifact.

    Resolution order:
    1. Prefer the minified artifact from ``dist/`` if it exists.
    2. Fall back to the source file.

    Components that use ES module ``import`` (migrated ones) **must** be
    read from the bundled artifact, which is always present after a
    ``make build-js`` run.

    Returns ``""`` when neither the source nor the artifact exists (a
    component simply may not ship a given CSS/JS asset).
    """
    if artifact.is_file():
        return artifact.read_text(encoding="utf-8")
    if src.is_file():
        return src.read_text(encoding="utf-8")
    return ""


def _get_js(filename: str) -> str:
    src = js_dir.joinpath(filename)
    return _load_asset(src, dist_dir.joinpath(f"{src.stem}.min.js"))


def _get_css(filename: str) -> str:
    src = css_dir.joinpath(filename)
    return _load_asset(src, dist_dir.joinpath(f"{src.stem}.min.css"))


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
        self._config: dict = {}

    @property
    def _config_block(self) -> str:
        """Render the CONFIG assignment as a JS-safe string at render time.

        Evaluated by Jinja when the template renders, so any mutations made to
        ``self._config`` in a subclass's :meth:`render` (e.g. LayerControl's
        ``initialData``) are reflected in the output.
        """
        if not self._config:
            return ""
        return (
            "window.foliplus = window.foliplus || {};\n"
            "window.foliplus.CONFIG = window.foliplus.CONFIG || {};\n"
            f"window.foliplus.CONFIG[{self._name!r}] = {dumps(self._config)};\n"
        )

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
                Element(_build_shared_header()), name=_SHARED_ASSETS_NAME
            )
        super().render(**kwargs)

    def _get_template(
        self,
        *,
        js: str | None = None,
        css: str | None = None,
        config: dict | None = None,
    ) -> Template:
        """Build a Jinja2 template with this control's own CSS/JS.

        Shared assets (``common.css``, ``panel.css``, ``runtime.js``, and the locale
        tables) are injected once per map by :meth:`render`, so this template only
        carries the component-specific CSS/JS plus a small call to resolve the locale
        from the shared ``window.foliplus._TABLES``.

        Parameters
        ----------
        js : str, optional
            Component JS filename. For migrated components the path is
            resolved from ``self._name`` automatically (``{name}/{name}.js``).
            Explicit paths (e.g. ``"LayerControl.js"``) are used as-is.

        css : str, optional
            Component CSS filename.  Automatically resolved from
            ``self._name`` when omitted (``{name}.css``).

        config : dict, optional
            Runtime config injected as ``window.foliplus.CONFIG[component]`` before the
            component JS runs. Frees the JS source from Jinja tags.

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        js = js or f"{self._name}/{self._name}.js"
        js = _get_js(js) if js else ""
        css = css or f"{self._name}.css"
        css = _get_css(css) if css else ""

        if config is not None:
            self._config = config

        return Template(
            dedent(f"""\
            {{% macro html(this, kwargs) %}}
            <style>
            {css}
            </style>
            {{% endmacro %}}

            {{% macro script(this, kwargs) %}}
            (function() {{
            if (window.foliplus && window.foliplus.resolveLocale) {{
                window.foliplus.resolveLocale({{{{ this._locale_code | tojson }}}}, window.foliplus._TABLES);
            }}
            const map = {{{{ this._parent.get_name() }}}};
            {{{{ this._config_block | safe }}}}
            {js}
            }})();
            {{% endmacro %}}""")
        )
