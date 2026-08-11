"""Base class and shared asset pipeline for all foliplus controls.

Every foliplus component (FullscreenControl, HeatmapControl, LayerControl, ...)
inherits from :class:`BaseControl`. This module owns the Python → JS bridge:

* **Shared assets** — ``common.css`` (with ``panel.css`` merged in), ``runtime.js``
  (with ``runtime/*.js`` bundled) and the common locale tables are emitted **once per
  map** into ``<head>`` by :meth:`BaseControl.render`, deduplicated by
  :data:`_SHARED_ASSETS_NAME`.

* **Config serialization** — each control's instance attributes are serialized into
  the JS ``CONF`` object. The static part is assembled by :meth:`BaseControl._build_config`
  (shared ``name``/``position`` keys + subclass-declared :attr:`_export_fields` +
  dynamic :meth:`_extra_config` data), then :attr:`BaseControl._config_block` overlays
  the locale tables and code.
"""

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

    Subclasses declare which instance attributes are exported to the JS ``CONF`` object
    via :attr:`_export_fields`, and may supply dynamic render-time data by overriding
    :meth:`_extra_config`. The base class merges these with the shared
    ``name``/``position`` keys and the locale tables into the ``CONF`` dict.

    Parameters
    ----------
    position : str, default "topleft"
        One of ``"topleft"``, ``"topright"``, ``"bottomleft"``, ``"bottomright"``.

    locale : str or LocaleConfig, optional
        Language code (``"en"``, ``"zh"``) or a :class:`LocaleConfig` instance. If
        omitted, the browser's ``navigator.language`` is used at runtime to select the
        appropriate locale table, falling back to English.
    """

    #: Instance attributes re-exported as JS ``CONF`` keys (key name == attr name).
    #:
    #: Subclasses declare their public configuration fields here. Each name is looked
    #: up via ``getattr(self, name)`` during :meth:`_build_config`, so the attribute
    #: must be set in ``__init__`` before the template is rendered.
    _export_fields: tuple[str, ...] = ()

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
        """Render the JS ``CONF`` dict as a JSON string for IIFE injection.

        Builds on the static config from :meth:`_build_config` (cached on
        :attr:`_config`) and overlays the two render-time pieces only known when
        the template is rendered:

        * ``locale_tables`` — this control's own locale table for resolving translated
          strings at runtime.
        * ``locale_code`` — the resolved language code (``"en"``, ``"zh"``, ...).

        Returns ``"{}"`` when the config is empty, otherwise a JSON string safe for
        inline ``<script>`` injection.
        """
        config = dict(self._build_config())
        config["locale_tables"] = _load_tables(f"{self._name}.*.json")
        config["locale_code"] = self._locale.code if self._locale else ""
        return dumps(config) if config else "{}"

    def _extra_config(self) -> dict:
        """Return render-time config injected into the JS ``CONF`` object.

        Subclasses override this to supply data that is only known at render time
        (e.g. LayerControl's layer list collected from the parent map). The base
        implementation returns an empty dict.
        """
        return {}

    def _build_config(self) -> dict:
        """Assemble the static part of the JS ``CONF`` dict.

        The merge order is:

        1. Shared keys — ``name`` and ``position`` (always present).
        2. Exported fields — every attribute named in :attr:`_export_fields`.
        3. Dynamic data — whatever :meth:`_extra_config` returns (render-time only,
           e.g. LayerControl's layer list).

        Later entries win on key conflicts. The result is cached on :attr:`_config` so
        tests can inspect exactly what gets serialized into the JS ``CONF`` object.
        :attr:`_config_block` copies this dict before adding the locale overlay, so
        the cache is never polluted with render-time keys.
        """
        config = {"name": self._name, "position": self.position}
        config.update({f: getattr(self, f) for f in self._export_fields})
        config.update(self._extra_config())
        self._config = config
        return config

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

    def _get_template(self) -> Template:
        """Build a Jinja2 template with this control's own CSS/JS.

        Shared assets (``common.css`` with ``panel.css`` merged in, ``runtime.js``, and
        the locale tables) are injected once per map by :meth:`render`, so this template
        only carries the component-specific CSS/JS plus a small call to resolve the
        locale from the shared ``window.foliplus._TABLES``.

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        js = _load_asset(dist_dir.joinpath(f"{self._name}.min.js"))
        css = _load_asset(dist_dir.joinpath(f"{self._name}.min.css"))

        return Template(
            dedent(f"""\
            {{% macro html(this, kwargs) %}}
            <style>
            {css}
            </style>
            {{% endmacro %}}

            {{% macro script(this, kwargs) %}}
            (() => {{
            const map = {{{{ this._parent.get_name() }}}};
            const CONF = {{{{ this._config_block | safe }}}};
            {js}
            }})();
            {{% endmacro %}}""")
        )
