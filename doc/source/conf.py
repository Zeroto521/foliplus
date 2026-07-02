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
templates_path = []
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "**.ipynb_checkpoints"]

language = "en"

# ── Autodoc ───────────────────────────────────────────────────────────
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "undoc-members": True,
    "show-inheritance": True,
}
autosummary_generate = True
napoleon_google_docstring = True
napoleon_numpy_docstring = False


# ── Linkcode ──────────────────────────────────────────────────────────
# based on pandas/doc/source/conf.py
def linkcode_resolve(domain: str, info: dict[str, str]) -> str | None:
    """
    Determine the URL corresponding to Python object
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
        fn = None

    if not fn:
        return None

    # to fix these doc doesn't exist in foliplus
    if project not in fn:
        return None

    try:
        source, lineno = inspect.getsourcelines(obj)
    except OSError:
        lineno = None

    linespec = f"#L{lineno}-L{lineno + len(source) - 1}" if lineno else ""
    fn = str(Path(fn).relative_to(Path(foliplus.__file__).parent))

    if _readthedocs_version == "latest":
        return f"{github_url}/blob/main/{project}/{fn}{linespec}"
    return f"{github_url}/blob/v{version}/{project}/{fn}{linespec}"


# ── Intersphinx ───────────────────────────────────────────────────────
intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "folium": ("https://python-visualization.github.io/folium/latest/", None),
}

# ── MyST-NB (Jupyter Notebook) ───────────────────────────────────────
nb_execution_mode = "off"  # notebooks are pre-executed; set "cache" to auto-execute
nb_mime_priority_overrides = [
    ("html", "text/html", 10),
    ("html", "image/png", 20),
]

# ── MyST options ─────────────────────────────────────────────────────
myst_enable_extensions = ["colon_fence", "substitution"]

# ── HTML output ───────────────────────────────────────────────────────
html_theme = "pydata_sphinx_theme"
html_static_path = ["_static"]
html_css_files = ["custom.css"]
html_js_files = [
    ("custom-icons.js", {"defer": "defer"}),
]
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
