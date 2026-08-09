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
from .locale import LocaleConfig, _load_tables, resolve_locale

src_dir = Path(__file__).parent
js_dir = src_dir / "js"
css_dir = src_dir / "css"
dist_dir = src_dir / "dist"

# Stable child name used to deduplicate the shared asset bundle in a figure's
# header, so runtime.js / common.css / locale tables are emitted only once per map.
_SHARED_ASSETS_NAME = "foliplus_shared"


@cache
def _build_shared_header() -> str:
    """Build the shared asset bundle (<style> + <script>) injected once per map.

    Contains common.css (with panel.css merged in), runtime.js (with runtime/*.js
    bundled in), and the common locale tables (shared by all components).
    Built once and cached at module level.
    """
    common = (dist_dir / "common.min.css").read_text(encoding="utf-8")
    runtime = (dist_dir / "runtime.min.js").read_text(encoding="utf-8")

    return (
        "<style>\n"
        f"{common}\n"
        "</style>\n"
        "<script>\n"
        f"{runtime}\n"
        "window.foliplus = window.foliplus || {};\n"
        f"window.foliplus._TABLES = {dumps(_load_tables('common.*.json'), ensure_ascii=False)};\n"
        "</script>"
    )


def _load_asset(artifact: Path) -> str:
    """Read an asset, preferring the minified artifact.

    Resolution order:
    1. Prefer the minified artifact from ``dist/`` if it exists.
    2. Fall back to the source file.

    Components that use ES module ``import`` (migrated ones) **must** be read from the
    bundled artifact, which is always present after a ``make build-js`` run.

    Returns ``""`` when neither the source nor the artifact exists (a component simply
    may not ship a given CSS/JS asset).
    """

    return artifact.read_text(encoding="utf-8") if artifact.is_file() else ""


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
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance. If
        omitted, the browser's ``navigator.language`` is used at runtime to select the
        appropriate locale table, falling back to English.
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
        self._locale = (
            resolve_locale(locale, self._name) if locale is not None else None
        )
        self._config: dict = {}

    @property
    def _locale_code(self) -> str:
        """Legacy property — returns the locale code for tests."""
        return self._locale.code if self._locale else ""

    @property
    def _config_block(self) -> str:
        """Render the CONFIG dict as a JSON string for IIFE injection."""
        config = dict(self._config)
        config["locale_tables"] = _load_tables(f"{self._name}.*.json")
        config["locale_code"] = self._locale.code if self._locale else ""
        return dumps(config) if config else "{}"

    def render(self, **kwargs):
        """Inject the shared asset bundle into the figure header exactly once.

        The runtime JS, shared CSS, and locale tables are identical for every control,
        so they are emitted a single time per map (deduplicated by
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

    def _get_template(self, *, config: dict | None = None) -> Template:
        """Build a Jinja2 template with this control's own CSS/JS.

        Shared assets (``common.css`` with ``panel.css`` merged in, ``runtime.js``, and the locale
        tables) are injected once per map by :meth:`render`, so this template only
        carries the component-specific CSS/JS plus a small call to resolve the locale
        from the shared ``window.foliplus._TABLES``.

        Parameters
        ----------
        config : dict, optional
            Runtime config injected as ``window.foliplus.CONFIG[component]`` before the
            component JS runs. Frees the JS source from Jinja tags.

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        js = _load_asset(dist_dir.joinpath(f"{self._name}.min.js"))
        css = _load_asset(dist_dir.joinpath(f"{self._name}.min.css"))

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
            const map = {{{{ this._parent.get_name() }}}};
            const CONF = {{{{ this._config_block | safe }}}};
            {js}
            }})();
            {{% endmacro %}}""")
        )
