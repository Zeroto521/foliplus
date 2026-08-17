"""
Sphinx configuration for foliplus documentation.
"""

from __future__ import annotations

import inspect
import os
import sys
from datetime import datetime
from pathlib import Path

import foliplus
from foliplus import __version__

# ── Project information ──────────────────────────────────────────────
project = "foliplus"
author = "@Zeroto521"
copyright = f"2021-{datetime.now().year} {author}"
version = release = __version__
github_url = f"https://github.com/Zeroto521/{project}"
_readthedocs_version = os.environ.get("READTHEDOCS_VERSION", "latest")

# ── General configuration ────────────────────────────────────────────
extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.napoleon",
    "sphinx.ext.intersphinx",
    "sphinx.ext.linkcode",
    "sphinx_copybutton",
    "myst_nb",
    "sphinx_design",
]

source_suffix = {".rst": "restructuredtext", ".md": "myst-nb", ".ipynb": "myst-nb"}
templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "**.ipynb_checkpoints"]

language = "en"

# ── Autodoc ───────────────────────────────────────────────────────────
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "undoc-members": True,
    "show-inheritance": True,
    "inherited-members": True,
}
autosummary_generate = True
napoleon_google_docstring = True
napoleon_numpy_docstring = False


# ── Linkcode ──────────────────────────────────────────────────────────
# based on pandas/doc/source/conf.py
# ── Generalized linkcode ──────────────────────────────────────────────
# Maps known external packages to their GitHub repos and package-root
# names. Entries not in this map fall back to the default project.
_LINKCODE_REPOS = {
    "folium": {
        "repo": "https://github.com/python-visualization/folium",
        "root": "folium",
        "branch": "main",
    },
    "branca": {
        "repo": "https://github.com/python-visualization/branca",
        "root": "branca",
        "branch": "main",
    },
}


def _resolve_source_url(source_path: Path, lineno: int, source_len: int) -> str | None:
    """Generate a GitHub source URL for any installed Python package.

    Looks up _LINKCODE_REPOS for the first matching package name in the
    file path, then builds the URL from the repo config and the relative
    path from the package root. Falls back to the default project
    (foliplus) when no external package matches.
    """
    resolved = source_path.resolve()
    parts = list(resolved.parts)

    # Try external packages first
    for pkg_name, cfg in _LINKCODE_REPOS.items():
        try:
            idx = parts.index(pkg_name)
        except ValueError:
            continue
        rel_path = str(Path(*parts[idx + 1 :])).replace(os.sep, "/")
        linespec = f"#L{lineno}-L{lineno + source_len - 1}" if lineno else ""
        return f"{cfg['repo']}/blob/{cfg['branch']}/{cfg['root']}/{rel_path}{linespec}"

    # Fall back to the default project (foliplus)
    foliplus_root = Path(foliplus.__file__).resolve().parent
    try:
        rel_path = str(resolved.relative_to(foliplus_root)).replace(os.sep, "/")
    except ValueError:
        return None

    branch = "main" if _readthedocs_version == "latest" else f"v{version}"
    linespec = f"#L{lineno}-L{lineno + source_len - 1}" if lineno else ""
    return f"{github_url}/blob/{branch}/{project}/{rel_path}{linespec}"


def linkcode_resolve(domain: str, info: dict[str, str]) -> str | None:
    """Resolve any Python object to its GitHub source URL.

    Works for foliplus code and any registered external dependency
    (folium, branca, …). Falls through gracefully when the source
    file cannot be found or the object is not in any known package.
    """
    if domain != "py":
        return None

    submod = sys.modules.get(info["module"])
    if submod is None:
        return None

    obj = submod
    for part in info["fullname"].split("."):
        try:
            obj = getattr(obj, part)
        except AttributeError:
            return None

    try:
        fn = inspect.getsourcefile(inspect.unwrap(obj))
    except TypeError:
        return None

    if fn is None:
        return None

    try:
        source_lines, lineno = inspect.getsourcelines(obj)
    except (OSError, TypeError):
        return None

    return _resolve_source_url(Path(fn), lineno, len(source_lines))


# ── Intersphinx ───────────────────────────────────────────────────────
intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "branca": ("https://python-visualization.github.io/branca/", None),
    "folium": ("https://python-visualization.github.io/folium/latest/", None),
}

# ── Missing reference resolver ────────────────────────────────────────
# folium's objects.inv omits JSCSSMixin (an internal mixin), so
# intersphinx cannot resolve it. Hook missing-reference to link to the
# folium source on GitHub instead of rendering it as plain text.
_MISSING_REF_MAP: dict[str, str] = {}


def _build_missing_ref_map() -> None:
    """Populate _MISSING_REF_MAP from the installed folium source.

    Reuses _resolve_source_url so the URL format is consistent with
    linkcode_resolve and automatically tracks the installed version.
    """
    import inspect

    from folium.elements import JSCSSMixin

    fn = inspect.getsourcefile(inspect.unwrap(JSCSSMixin))
    if fn is None:
        return

    try:
        source_lines, lineno = inspect.getsourcelines(JSCSSMixin)
    except (TypeError, OSError):
        return

    url = _resolve_source_url(Path(fn), lineno, len(source_lines))
    if url:
        _MISSING_REF_MAP["JSCSSMixin"] = url
        _MISSING_REF_MAP["folium.elements.JSCSSMixin"] = url


def _resolve_missing_reference(app, env, node, contnode):
    """Manually resolve references that intersphinx cannot.

    folium's published objects.inv omits JSCSSMixin (an internal mixin),
    so Sphinx renders it as plain text. Link it to folium's GitHub source.
    """
    target = node.get("reftarget", "")
    url = _MISSING_REF_MAP.get(target)
    if url is None:
        # Try matching by substring (handles "folium.elements.JSCSSMixin")
        for key, url_val in _MISSING_REF_MAP.items():
            if key in target:
                url = url_val
                break
    if url is not None:
        from docutils import nodes

        return nodes.reference(
            "",
            contnode.astext(),
            refuri=url,
            reftitle=url,
        )
    return None


def setup(app):
    _build_missing_ref_map()
    app.connect("missing-reference", _resolve_missing_reference)
    return {}


# ── MyST-NB (Jupyter Notebook) ───────────────────────────────────────
nb_execution_mode = "cache"  # auto-execute and cache results
nb_execution_timeout = 60
nb_mime_priority_overrides = [
    ("html", "text/html", 10),
    ("html", "image/png", 20),
]

# ── MyST options ─────────────────────────────────────────────────────
myst_enable_extensions = ["colon_fence", "substitution"]

# ── HTML output ───────────────────────────────────────────────────────
html_theme = "pydata_sphinx_theme"
html_static_path = ["_static", "data"]
html_css_files = ["custom.css"]
html_js_files = [("icon.js", {"defer": "defer"})]
html_show_sourcelink = False  # sidebar "sourcelink" already provides this
html_show_sphinx = False

# ── Options for PyData theme ──────────────────────────────────────────
html_theme_options = {
    "icon_links": [
        {
            "name": "GitHub",
            "url": github_url,
            "icon": "fa-brands fa-github",
        },
        {
            "name": "PyPI",
            "url": f"https://pypi.org/project/{project}",
            "icon": "fa-custom fa-pypi",
        },
    ],
    "logo": {"text": project},
    "use_edit_page_button": True,
    "show_toc_level": 1,
    "navbar_align": "left",
    "show_version_warning_banner": True,
    "pygments_light_style": "default",
    "pygments_dark_style": "monokai",
    "secondary_sidebar_items": ["page-toc", "edit-this-page"],
}

html_sidebars = {
    "**": ["sidebar-nav-bs"],
}

html_context = {
    "github_user": "Zeroto521",
    "github_repo": project,
    "github_version": "main",
    "doc_path": "doc/source",
}

# ── Copy button ───────────────────────────────────────────────────────
copybutton_prompt_text = ">>> "
copybutton_line_continuation_character = "\\"
copybutton_exclude = ".linenos, .gp"
copybutton_selector = ":not(.prompt) > div.highlight pre"
