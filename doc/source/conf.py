"""Sphinx configuration for foliplus documentation."""

from __future__ import annotations

import inspect
import os
import re
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
# Each entry maps a package name (as it appears in the filesystem path)
# to its GitHub repo, package-root name, and git ref. The ref may be
# a static string or a callable that returns one (for the default
# project, which needs dynamic version→SHA resolution on RTD).
_LINKCODE_REPOS = {
    "foliplus": {
        "repo": github_url,
        "root": project,
        "ref": lambda: _resolve_git_ref(version),
    },
    "folium": {
        "repo": "https://github.com/python-visualization/folium",
        "root": "folium",
        "ref": "main",
    },
    "branca": {
        "repo": "https://github.com/python-visualization/branca",
        "root": "branca",
        "ref": "main",
    },
}


def _resolve_git_ref(ver: str) -> str:
    """Extract the git ref from a PEP-440 version string.

    ReadTheDocs builds use local versions that embed the current commit
    SHA:  0.3.2.dev62+gf116f81a8.d20260817
    The "+g<sha>" part is git-describe output; the actual commit hash is
    everything after the "g". Use that as the GitHub blob ref instead
    of the whole version string, which is not a valid git ref.
    """
    if _readthedocs_version == "latest":
        return "main"
    m = re.search(r"\+g([0-9a-f]+)", ver)
    if m:
        return m.group(1)
    return f"v{ver}"


def _resolve_source_url(source_path: Path, lineno: int, source_len: int) -> str | None:
    """Generate a GitHub source URL for any installed Python package.

    Uses importlib to locate each known package's installed root directory,
    then checks if the source file falls within it. This avoids false
    matches from coincidental directory names in parent paths.
    """
    import importlib

    resolved = source_path.resolve()

    for pkg_name, cfg in _LINKCODE_REPOS.items():
        try:
            pkg = importlib.import_module(pkg_name)
        except ImportError:
            continue
        try:
            pkg_root = Path(pkg.__file__).resolve().parent
        except AttributeError:
            continue
        try:
            rel_path = str(resolved.relative_to(pkg_root)).replace(os.sep, "/")
        except ValueError:
            continue
        ref = cfg["ref"]() if callable(cfg["ref"]) else cfg["ref"]
        linespec = f"#L{lineno}-L{lineno + source_len - 1}" if lineno else ""
        return f"{cfg['repo']}/blob/{ref}/{cfg['root']}/{rel_path}{linespec}"

    return None


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
    """Populate _MISSING_REF_MAP from the installed folium source."""
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
    # Exact match first, then dotted-path suffix match
    url = _MISSING_REF_MAP.get(target)
    if url is None:
        # Handle fully-qualified targets like "folium.elements.JSCSSMixin"
        for key, url_val in _MISSING_REF_MAP.items():
            if (
                target == key
                or target.endswith(":" + key)
                or target.endswith("." + key)
            ):
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
nb_execution_mode = "cache"
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
html_show_sourcelink = False
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
