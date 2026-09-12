"""Base class and shared asset pipeline for all foliplus controls.

Every foliplus component (FullscreenControl, HeatmapControl, LayerControl, ...)
inherits from :class:`BaseControl`. This module owns the Python → JS bridge:

* **Shared assets** — the merged shared stylesheet (``css/common/*.css``),
  ``runtime.js`` (with ``runtime/*.js`` bundled) and the common locale tables are
  emitted **once per map** into ``<head>`` by :meth:`BaseControl.render`,
  deduplicated by :data:`_SHARED_ASSETS_NAME`.

* **Config serialization** — each control's instance attributes are serialized into
  the JS ``CONF`` object. The static part is assembled by :meth:`BaseControl._build_config`
  (shared ``name``/``position`` keys + subclass-declared :attr:`_export_fields` +
  dynamic :meth:`_extra_config` data), then :attr:`BaseControl._config_block` overlays
  the locale tables and code.
"""

from __future__ import annotations

from functools import cache
from pathlib import Path
from textwrap import dedent

from branca.element import Element, Figure
from folium import MacroElement
from folium.elements import JSCSSMixin
from jinja2 import Template
from jinja2.utils import htmlsafe_json_dumps

from ._typing import Position
from ._validate import validate
from .locale import LocaleConfig, _load_tables, resolve_locale

# JS line terminators. Legal JSON, but emitted literally they would end the
# containing ``<script>`` statement early — folium's ``|tojson`` drops them,
# so this pass matches what folium already guarantees for the same payload.
_LINE_TERMINATORS = {chr(0x2028): "\\u2028", chr(0x2029): "\\u2029"}


def _safe_json(value: object) -> str:
    """Serialize ``value`` for injection into a classic ``<script>`` tag.

    Wraps Jinja's :func:`htmlsafe_json_dumps` — the same routine behind
    folium's own ``|tojson`` filter — so a ``<``, ``>``, ``&``, or ``'`` in a
    model-supplied string can never close the script tag.

    Adds one thing folium does not: U+2028/U+2029 are emitted as ``\\u2028``
    escapes instead of literal characters, which are valid JSON but would
    terminate the enclosing statement if written bare.

    ``ensure_ascii=False`` is deliberate — layer names are usually CJK, and
    ``\\uXXXX`` escapes would roughly double the size of the shared locale
    tables injected once per map.
    """
    text = str(htmlsafe_json_dumps(value, ensure_ascii=False))
    for raw, escape in _LINE_TERMINATORS.items():
        text = text.replace(raw, escape)
    return text


src_dir = Path(__file__).parent
dist_dir = src_dir / "dist"

# Stable child name used to deduplicate the shared asset bundle in a figure's
# header, so runtime.js / the merged shared stylesheet / locale tables are
# emitted only once per map.
_SHARED_ASSETS_NAME = "foliplus_shared"


@cache
def _build_shared_header() -> str:
    """Build the shared asset bundle (<style> + <script>) injected once per map.

    Contains the merged shared stylesheet (all of css/common/), runtime.js
    (with runtime/*.js bundled in), and the common locale tables (shared by
    all components).
    Built once and cached at module level.
    """
    css = (dist_dir / "foliplus-common.min.css").read_text(encoding="utf-8")
    js = (dist_dir / "foliplus-common.min.js").read_text(encoding="utf-8")

    return (
        "<style>\n"
        f"{css}\n"
        "</style>\n"
        "<script>\n"
        f"{js}\n"
        "window.foliplus = window.foliplus || {};\n"
        f"window.foliplus._TABLES = {_safe_json(_load_tables('common.*.json'))};\n"
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


@cache
def _build_component_template(name: str) -> Template:
    """Read a component's JS/CSS and compile its Jinja template once (cached).

    The template is identical for every instance of a component (only the
    render-time CONF / map name differ, both resolved at render time), so it
    is built a single time per component name instead of on every render.
    """
    js = _load_asset(dist_dir.joinpath(f"foliplus-{name}.min.js"))
    css = _load_asset(dist_dir.joinpath(f"foliplus-{name}.min.css"))

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
    #: must be set in ``__init__`` before the template is rendered. A name that does
    #: not resolve raises ``ValueError`` from :meth:`_build_config` (fail-fast) rather
    #: than failing later as a bare ``AttributeError``.
    _export_fields: tuple[str, ...] = ()

    @validate
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
        """The resolved locale code, or ``""`` when unset (auto-detect at runtime).

        A lightweight assertion point: it exposes the resolved code without
        rendering, which would otherwise require the full Jinja2 + dist pipeline.
        """
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

        The JSON is escaped through :func:`_safe_json` rather than plain
        ``json.dumps``: config values can carry model-supplied strings (layer
        names, export filenames, ...), and a literal ``</script>`` inside them
        would otherwise close the inline script tag and let the rest of the
        string execute as script.
        """
        config = dict(self._build_config())
        # A LocaleConfig carrying its own strings (from_json / resolve_locale) layers
        # those over a built-in per-component table, so a partial custom table only
        # overrides the keys it declares and leaves the rest translated. A code that
        # has no built-in table (a genuinely new language from from_json) falls back
        # to English, which carries every key. Empty strings mean "auto-detect at
        # runtime", so ship the built-in tables with no overlay.
        code = self._locale.code if self._locale else ""
        strings = self._locale._strings if self._locale else {}
        builtins = _load_tables(f"{self._name}.*.json")
        base = dict(builtins.get(code, builtins.get("en", {})))
        config["locale_tables"] = {
            code or "en": {**base, **strings} if strings else base
        }
        config["locale_code"] = code
        # config always contains at least name/position — never empty.
        return _safe_json(config)

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
        2. Exported fields — every attribute named in :attr:`_export_fields`. A name
           that does not resolve to a real instance attribute raises ``ValueError``
           (fail-fast, naming the control and the offending field).
        3. Dynamic data — whatever :meth:`_extra_config` returns (render-time only,
           e.g. LayerControl's layer list).

        Later entries win on key conflicts. The result is cached on :attr:`_config` so
        tests can inspect exactly what gets serialized into the JS ``CONF`` object.
        :attr:`_config_block` copies this dict before adding the locale overlay, so
        the cache is never polluted with render-time keys.
        """
        config = {"name": self._name, "position": self.position}
        for f in self._export_fields:
            try:
                config[f] = getattr(self, f)
            except AttributeError:
                raise ValueError(
                    f"{self._name}._export_fields: '{f}' not set in __init__"
                ) from None
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

        Shared assets (the merged ``css/common/`` stylesheet, ``runtime.js``, and the
        locale tables) are injected once per map by :meth:`render`, so this template
        only carries the component-specific CSS/JS plus a small call to resolve the
        locale from the shared ``window.foliplus._TABLES``.

        Returns
        -------
        Template
            A Jinja2 ``Template`` instance ready for folium rendering.
        """
        return _build_component_template(self._name)
