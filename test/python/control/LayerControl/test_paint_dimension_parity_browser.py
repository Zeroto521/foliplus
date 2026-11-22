"""Parity harness for the S6 PaintDimension engine — browser baseline test.

This is the CI side of the two-layer parity harness (s6-parity-harness-design.md).
The JS probe test/js/browser/LayerControl/sample_paint_dimension.js is the
shared sampler; this test drives it through Playwright and compares the DOM /
class-stack / aria / computed-style snapshot against the baseline fixture
test/python/control/LayerControl/paint-dimension.baseline.json.

The baseline is the S1-S5 snapshot (recorded on the post-S5 code — S5 merged
before this harness landed, so there is no separate S1-S4 baseline). S6.x must
NOT touch the baseline except via the explicit S6.0 re-record.

Run:
    PYTHONPATH=<worktree-root> uv run pytest -q \
      test/python/control/LayerControl/test_paint_dimension_parity_browser.py \
      -m browser
Re-record the baseline:
    UPDATE_BASELINE=1 PYTHONPATH=<worktree-root> uv run pytest -q \
      test/python/control/LayerControl/test_paint_dimension_parity_browser.py \
      -m browser

The harness self-check (a deliberate drift must turn red) is a separate,
temporary mutation the builder performs once — see s6-parity-harness-design.md
"判死自检". This test file only verifies the baseline is green.
"""

from __future__ import annotations

import os

import folium
import pytest
from conftest import _js, panel_ready, use_page

from foliplus import LayerControl

from . import paint_parity as pp
from ._browser_base import LayerControlBrowserBase


class TestPaintDimensionParityBrowser(LayerControlBrowserBase):
    """Baseline parity of the paint-dimension rows against the pre-S6 baseline."""

    # The geometry -> layer name map (fixture names in build_layers).
    GEOM_LAYER = {
        "point": "Points",
        "line": "Lines",
        "polygon": "Polygons",
    }

    @pytest.mark.browser
    def test_paint_dimension_parity(self, browser, tmp_path):
        """Sample every offered group and compare against the baseline.

        With UPDATE_BASELINE=1 the snapshot is written as the new baseline
        instead (S6.0 baseline recording / explicit S6.0 re-record after S5).
        """
        update = os.environ.get("UPDATE_BASELINE") == "1"
        point, line, polygon = pp.build_layers()
        with use_page(
            self._make_page,
            browser,
            tmp_path,
            point,
            line,
            polygon,
            slug="paint_dimension_parity",
        ) as (page, errors):
            panel_ready(page)
            # Expand the panel so the overlay rows are rendered.
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )

            # Sample each geometry's fill + border rows. The probe asks the full
            # mode matrix and records present:false for a mode the layer does
            # not offer, so the baseline locks the offering too.
            snapshot: dict = {"fill": {}, "border": {}}
            for geom, layer_name in self.GEOM_LAYER.items():
                res = page.evaluate(
                    _js("LayerControl/sample_paint_dimension"),
                    {
                        "layerName": layer_name,
                        "dims": ["fill", "border"],
                        "modes": {
                            "fill": list(pp.FILL_MODES),
                            "border": list(pp.BORDER_MODES[geom]),
                        },
                    },
                )
                assert res.get("ok"), f"{geom}: sampler failed: {res}"
                for dim in ("fill", "border"):
                    for mode, entry in res["snapshot"].get(dim, {}).items():
                        snapshot.setdefault(dim, {}).setdefault(mode, {})[geom] = entry

            assert not errors, f"JS errors: {errors}"

            if update:
                pp.write_baseline(snapshot)
                return

            baseline = pp.load_baseline()
            diffs = pp.compare(baseline, snapshot)
            assert not diffs, "paint-dimension parity drift:\n" + "\n".join(diffs)
