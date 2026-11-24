"""The dist/ artifact pipeline every control renders through.

Owns the one place that maps a component name to its bundled artifacts: the
manifest the JS build writes, the shared `<style>`/`<script>` header injected
once per map, and the cached Jinja template per component. Split out of
`BaseControl.py` so the base class stays a class (the render contract) while the
build-artifact knowledge lives next to it as `_asset`.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path
from textwrap import dedent

from jinja2 import Template
from jinja2.utils import htmlsafe_json_dumps

from .locale import _load_component_tables, _load_tables

src_dir = Path(__file__).parent
dist_dir = src_dir / "dist"

# `script/build/build.mjs` writes this on every real build, listing what actually
# landed in `dist/`. Both test suites read it instead of re-deriving the
# artifact names from prose, so a new component can't be forgotten on one
# side and pass on the other.
MANIFEST = dist_dir / "manifest.json"

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
    escapes instead of literal characters.

    ``ensure_ascii=False`` is deliberate — layer names are usually CJK, and
    ``\\uXXXX`` escapes would roughly double the size of the shared locale
    tables injected once per map.
    """
    text = str(htmlsafe_json_dumps(value, ensure_ascii=False))
    for raw, escape in _LINE_TERMINATORS.items():
        text = text.replace(raw, escape)
    return text


# Stable child name used to deduplicate the shared asset bundle in a figure's
# header, so runtime.js / the merged shared stylesheet / locale tables are
# emitted only once per map.
_SHARED_ASSETS_NAME = "foliplus_shared"


@cache
def _build_shared_header() -> str:
    """Build the shared asset bundle (<style> + <script>) injected once per map.

    Contains the merged shared stylesheet (all of css/common/), runtime.js
    (with runtime/*.js bundled in), the common locale tables (shared by
    all components), and the per-component locale tables (all languages for
    all components, so the browser can auto-detect language at runtime).
    Built once and cached at module level.
    """
    missing = [
        a
        for a in (
            dist_dir / "foliplus-common.min.css",
            dist_dir / "foliplus-common.min.js",
        )
        if not a.is_file()
    ]
    if missing:
        raise MissingAssetsError(missing)
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
        f"window.foliplus._COMPONENT_TABLES = {_safe_json(_load_component_tables())};\n"
        "</script>"
    )


def _load_asset(artifact: Path) -> str:
    """Read one component artifact from ``dist/``.

    Raises :class:`MissingAssetsError` when the artifact is absent, so a package
    built without the JS build fails loudly instead of rendering an empty
    component.
    """

    if not artifact.is_file():
        raise MissingAssetsError([artifact])
    return artifact.read_text(encoding="utf-8")


def control_assets(name: str) -> tuple[Path, Path]:
    """Return the ``dist/`` pair for one control: ``(js, css)``.

    The single place that knows how a control name maps to artifacts, so a
    control cannot ship one half without the other.
    """

    return (
        dist_dir / f"foliplus-{name}.min.js",
        dist_dir / f"foliplus-{name}.min.css",
    )


def expected_artifacts() -> list[str]:
    """Every ``dist/`` filename a complete build emits, as bare names.

    Read from the manifest the build writes, not re-derived:
    ``test/python/script/build/test_asset.py`` asserts wheel membership against
    this list and ``build.test.ts`` asserts artifact presence, so a component
    added on one side fails both stacks.

    Filenames come through :func:`control_assets`, the one place that knows how
    a component name maps to artifacts — re-deriving them here would let a
    rename land on one side and miss the other.
    """

    names = json.loads(MANIFEST.read_text(encoding="utf-8"))["artifacts"]
    return [p.name for name in names for p in control_assets(name)]


@cache
def _build_component_template(name: str) -> Template:
    """Read a component's JS/CSS and compile its Jinja template once (cached).

    The template is identical for every instance of a component (only the
    render-time CONFIG / map name differ, both resolved at render time), so it
    is built a single time per component name instead of on every render.
    """
    js_artifact, css_artifact = control_assets(name)
    js = _load_asset(js_artifact)
    css = _load_asset(css_artifact)

    # jinja2's own stub types ``Template.__init__`` as returning Any, so the
    # constructor call needs an explicit annotation to satisfy the typed return.
    template: Template = Template(
        dedent(f"""\
    {{% macro html(this, kwargs) %}}
    <style>
    {css}
    </style>
    {{% endmacro %}}

    {{% macro script(this, kwargs) %}}
    (() => {{
    const map = {{{{ this._parent.get_name() }}}};
    const CONFIG = {{{{ this._config_block | safe }}}};
    {js}
    }})();
    {{% endmacro %}}""")
    )
    return template


class MissingAssetsError(RuntimeError):
    """Raised when a bundled asset is absent from ``dist/``.

    A control's JS/CSS and the shared runtime bundle ship as compiled artifacts
    in ``foliplus/dist/`` (see :data:`dist_dir`), which is not under version
    control. A package without them is unusable, so rendering fails fast with
    the build step named instead of emitting an empty ``<script>`` tag that dies
    with no clue in the browser console.
    """

    def __init__(self, missing: list[Path]) -> None:
        # A missing path outside the source tree (a test pointing `dist_dir`
        # at a throwaway copy) cannot be made repo-relative; the message must
        # not itself raise, so fall back to the absolute path.
        names = ", ".join(
            str(p.relative_to(src_dir.parent))
            if p.is_relative_to(src_dir.parent)
            else str(p)
            for p in missing
        )
        super().__init__(
            f"foliplus bundled assets missing: {names}. "
            "Run `make build-js` in the source checkout, then rebuild the "
            "package with `uv build` (`make dist` does both)."
        )
