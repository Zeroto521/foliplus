"""Browser tests for HeatmapControl remove→add lifecycle and listener hygiene."""

from __future__ import annotations

from conftest import _js, heatmap_ready, use_page

from .helper import _make_page


class TestHeatmapControlLifecycleBrowser:
    """Verify destroy() + addControl restarts the scan cleanly, and that
    remove→add cycles leave no listener residue on map, document, or window."""

    def test_remove_readd_restarts_scan(self, browser, tmp_path):
        """destroy() + addControl restarts the initial scan and re-renders."""
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            heatmap_ready(page)
            state = page.evaluate(_js("HeatmapControl/destroy_readd"))
            assert state["removed"] is True
            assert state["hasManager"] is True
            heatmap_ready(page)  # re-scan settles: [data-ready] re-appears
            assert not errors, f"JS errors: {errors}"

    def test_remove_readd_leaves_no_listener_residue(self, browser, tmp_path):
        """N=3 remove → add cycles must not grow map._events listener sum.

        Baseline round[0] is captured right after the initial addControl
        (which the harness already performed in page setup); rounds[1] and
        rounds[2] follow remove → add. A listener leak — whether it lands on
        round[0] or only shows up in a later round — registers as a drift
        and fails the assertion.
        """
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            heatmap_ready(page)
            state = page.evaluate(_js("HeatmapControl/destroy_readd"))
            rounds = state["rounds"]
            assert len(rounds) == 3, f"expected 3 rounds, got {rounds!r}"
            for i, n in enumerate(rounds[1:], start=1):
                assert n == rounds[0], (
                    f"HeatmapControl: map._events listener sum grew on round {i}: "
                    f"{rounds!r}"
                )
            heatmap_ready(page)
            assert not errors, f"JS errors: {errors}"

    def test_probe_leak_listener_control_group_grows(self, browser, tmp_path):
        """A single bare map.on() must register as a +1 in the listener sum.

        Control group for the drift gate above: if this control fails, the
        sumMapEvents measure is measuring nothing and the drift assertion
        in test_remove_readd_leaves_no_listener_residue has no teeth.
        """
        with use_page(
            _make_page, browser, tmp_path, expose_ctrl=True, num_layers=1
        ) as (page, errors):
            heatmap_ready(page)
            result = page.evaluate(_js("HeatmapControl/probe_leak_listener"))
            assert result["delta"] > 0, (
                f"Leak control group: expected a positive delta, got {result!r}"
            )
            assert not errors, f"JS errors: {errors}"

    def test_remove_readd_leaves_no_document_listener_residue(self, browser, tmp_path):
        """Two remove → add cycles with the dropdown open must not accumulate
        document/window listeners.

        The ``map._events`` gate above only counts listeners on the Leaflet map
        instance, which is the layer the orphan ``map.on("unload")`` class of
        leak lives on. This gate covers the other layer: HeatmapControl's
        scheme-dropdown outside-click handler is bound on document, and #408
        moved it from a bare ``document.addEventListener`` to the signal-managed
        ``ctrl.on(document, ...)`` form. Each cycle opens the dropdown before
        removing the control, so a listener still bound at removal time — a bare
        listener with no cleanup, or one bound to a controller that is never
        aborted — registers as drift.

        The counting probe is installed as a page prelude, so its counts are
        absolute rather than deltas measured from somewhere in the middle of the
        page's life. That makes both invariants checkable against the baseline:
        a re-attach must leave exactly the listeners that were there before the
        first cycle (``added[i] == base``), and every removal must tear down the
        same things (``closed[i] == closed[0]``). ``open`` doubles as a
        self-check on the measurement path.
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=1,
            prelude=_js("_probe/doc_listener_probe"),
        ) as (page, errors):
            heatmap_ready(page)
            state = page.evaluate(_js("HeatmapControl/doc_listener_drift"))
            assert all(o > c for o, c in zip(state["open"], state["closed"])), (
                "HeatmapControl: the scheme dropdown no longer binds a document "
                f"listener (open={state['open']!r}, closed={state['closed']!r}) — "
                "this gate has no teeth"
            )
            for i, n in enumerate(state["added"], start=1):
                assert n == state["base"], (
                    "HeatmapControl: the document/window listener count after a "
                    f"re-attach drifted on cycle {i} (base={state['base']}): "
                    f"{state!r}"
                )
            for i, n in enumerate(state["closed"][1:], start=1):
                assert n == state["closed"][0], (
                    "HeatmapControl: the document/window listener count after a "
                    f"removal drifted on cycle {i} (first={state['closed'][0]}): "
                    f"{state!r}"
                )
            heatmap_ready(page)
            assert not errors, f"JS errors: {errors}"

    def test_probe_leak_listener_doc_control_group_moves(self, browser, tmp_path):
        """Bare and signal-managed document listeners must both move the count.

        Control group for the drift gate above: without these two directions the
        flat verdict would be meaningless, and the ``AbortController.abort``
        hook in the shared probe — the part that keeps a signal-managed listener
        from registering as a phantom leak — would go untested.
        """
        with use_page(
            _make_page,
            browser,
            tmp_path,
            expose_ctrl=True,
            num_layers=1,
            prelude=_js("_probe/doc_listener_probe"),
        ) as (page, errors):
            heatmap_ready(page)
            result = page.evaluate(_js("HeatmapControl/probe_leak_listener_doc"))
            assert result["addDelta"] == 1, result
            assert result["removeDelta"] == -1, result
            assert result["signalAddDelta"] == 1, result
            assert result["abortDelta"] == -1, result
            assert result["settled"] == result["before"], result
            assert not errors, f"JS errors: {errors}"
