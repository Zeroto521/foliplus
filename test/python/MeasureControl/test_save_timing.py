"""Marker-persistence ordering check for foliplus.MeasureControl."""

from __future__ import annotations

from conftest import render_control

from foliplus import MeasureControl


class TestMeasureControlSaveTiming:
    """Marker is persisted before geocode resolves (Python-side check on
    the rendered HTML, no browser needed)."""

    def test_marker_saved_before_geocode(self):
        """Marker measurement is persisted immediately, before geocode resolves."""
        html = render_control(MeasureControl())
        # In the new-marker flow, the measurement is persisted via
        # store.add() BEFORE createLocationMarker() (which triggers the async
        # geocode), so a reload mid-lookup does not lose the marker. Search for
        # the save-then-create pattern within a small window (not the global
        # first occurrence, which may be in restore()).
        create_pos = html.find("createLocationMarker(")
        assert create_pos != -1, "createLocationMarker should exist"
        # Search for store.add within 200 chars BEFORE createLocationMarker
        search_start = max(0, create_pos - 200)
        save_pos = html.find("this.mgr.store.add(", search_start)
        assert save_pos != -1, "store.add() should exist before createLocationMarker"
        gap = create_pos - save_pos
        assert gap < 200, (
            "measurement must be saved right before triggering geocode so a "
            f"reload mid-lookup does not lose the marker (gap={gap})"
        )
