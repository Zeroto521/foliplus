"""Listener-lifecycle browser tests for foliplus.FullscreenControl.

Two-remove → add cycles must not accumulate document/window listeners, and
a control-group probe verifies the counter can actually see a real leak.
"""

from __future__ import annotations

from conftest import _js, use_page

from .helper import _make_page


class TestFullscreenLifecycleBrowser:
    """Browser-level listener-drift gates for FullscreenControl."""

    def test_remove_readd_leaves_no_document_listener_residue(self, browser, tmp_path):
        """Two remove → add cycles must not accumulate document/window listeners.

        The existing ``map._events`` gates only count listeners on the Leaflet
        map instance — the layer FullscreenControl's orphan ``map.on("unload")``
        lived on, so it is still covered by the other gates. This one covers the
        other layer: anything bound on document or window, where no gate
        existed.

        The counting probe is installed as a page prelude, so its counts are
        absolute rather than deltas measured from somewhere in the middle of the
        page's life. That makes both invariants checkable against the baseline:
        a re-attach must leave exactly the listeners that were there before the
        first cycle (``added[i] == base``), and every removal must tear down the
        same things (``closed[i] == closed[0]``).
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            prelude=_js("_probe/doc_listener_probe"),
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            state = page.evaluate(_js("FullscreenControl/doc_listener_drift"))
            for i, n in enumerate(state["added"], start=1):
                assert n == state["base"], (
                    "FullscreenControl: the document/window listener count after a "
                    f"re-attach drifted on cycle {i} (base={state['base']}): "
                    f"{state!r}"
                )
            for i, n in enumerate(state["closed"][1:], start=1):
                assert n == state["closed"][0], (
                    "FullscreenControl: the document/window listener count after a "
                    f"removal drifted on cycle {i} (first={state['closed'][0]}): "
                    f"{state!r}"
                )
            assert not errors, f"JS errors: {errors}"

    def test_probe_leak_listener_doc_control_group_moves(self, browser, tmp_path):
        """A bare document listener must move the document/window count.

        Control group for the drift gate above: without it, a flat count is
        compatible with the count measuring nothing. The signal-managed half of
        the counter — the AbortController.abort patch — is exercised by the gate
        itself, since FullscreenControl's own ``fullscreenchange`` binding is
        signal-managed and torn down on every removal.
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            prelude=_js("_probe/doc_listener_probe"),
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            result = page.evaluate(_js("FullscreenControl/probe_leak_listener_doc"))
            assert result["addDelta"] == 1, result
            assert result["removeDelta"] == -1, result
            assert not errors, f"JS errors: {errors}"
