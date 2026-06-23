"""
Sphinx configuration for foliplus documentation.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path

from foliplus import __version__

# ── Project information ──────────────────────────────────────────────
project = "foliplus"
author = "@Zeroto521"
copyright = f"2021-{datetime.now().year} {author}"
version = release = __version__
github_url = f"https://github.com/Zeroto521/{project}"

# ── General configuration ────────────────────────────────────────────
extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.autosummary",
    "sphinx.ext.extlinks",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "sphinx.ext.githubpages",
    "sphinx.ext.intersphinx",
    "sphinx.ext.linkcode",
    "sphinx_copybutton",
    "myst_nb",  # handles both .md and .ipynb
]

source_suffix = {".rst": "restructuredtext", ".md": "myst-nb", ".ipynb": "myst-nb"}
templates_path = ["_template"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store", "**.ipynb_checkpoints"]

language = "en"

# ── Autodoc ───────────────────────────────────────────────────────────
autodoc_default_options = {
    "members": True,
    "member-order": "bysource",
    "special-members": "__init__",
    "undoc-members": True,
    "show-inheritance": True,
}
autosummary_generate = True
napoleon_google_docstring = True
napoleon_numpy_docstring = False

# ── Intersphinx ───────────────────────────────────────────────────────
intersphinx_mapping = {
    "python": ("https://docs.python.org/3", None),
    "folium": ("https://python-visualization.github.io/folium/latest/", None),
}

# ── MyST-NB (Jupyter Notebook) ───────────────────────────────────────
nb_execution_mode = "off"  # notebooks are pre-executed
nb_mime_priority_overrides = [
    ("html", "text/html", 10),
    ("html", "image/png", 20),
]

# ── HTML output ───────────────────────────────────────────────────────
html_theme = "pydata_sphinx_theme"
html_static_path = ["_static"]
html_show_sourcelink = True
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
            "icon": "fas fa-box",
        },
    ],
    "logo": {
        "text": "foliplus",
    },
    "use_edit_page_button": True,
    "show_toc_level": 1,
    "navbar_align": "left",
    "header_links_before_dropdown": 6,
    "pygment_light_style": "default",
    "pygment_dark_style": "monokai",
    "secondary_sidebar_items": ["page-toc", "edit-this-page", "sourcelink"],
}

html_sidebars = {
    "**": ["sidebar-nav-bs", "page-toc"],
}

html_context = {
    "github_user": "Zeroto521",
    "github_repo": project,
    "github_version": "main",
    "doc_path": "doc/source",
}

# ── Copy button ───────────────────────────────────────────────────────
copybutton_prompt_text = ">>> "
copybutton_line_continuation_continuation_character = "\\"
