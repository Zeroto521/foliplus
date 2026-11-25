"""Browser tests: row dragging respects role blocks and row identity.

A cross-role drag is refused with a hint naming the block boundary, and a drop
resolves its target by `data-layer-id` — a DOM-position read would see the
dragged row as its own target and leave the registry behind the panel.
"""

from __future__ import annotations

import folium
from conftest import _js, panel_ready, use_page

from ..helper_browser import LayerControlBrowserBase


class TestRowDragBrowser(LayerControlBrowserBase):
    def test_cross_group_drag_shows_hint(self, browser, tmp_path):
        """Dragging overlay toward base role should show blocked hint."""
        overlay = folium.FeatureGroup(name="Overlay A", overlay=True, show=True)
        base = folium.TileLayer("CartoDB positron", name="Light Canvas", overlay=False)
        # The gate reads the hint's English wording, so pin the page locale
        # rather than depending on the machine's ambient language.
        with use_page(
            self._make_page, browser, tmp_path, overlay, base, locale="en"
        ) as (page, errors):
            page.evaluate(_js("LayerControl/open_panel"))
            page.wait_for_selector(
                ".foliplus-layer-ctrl.foliplus-is-expanded",
                state="attached",
                timeout=5000,
            )
            panel_ready(page)
            page.wait_for_selector(
                '.foliplus-layer-item[data-layer-type="base"]',
                state="attached",
                timeout=5000,
            )

            ok = page.evaluate(_js("LayerControl/dispatch_cross_group_dragover"))
            assert ok, "Failed to dispatch simulated cross-role dragover"

            page.wait_for_selector(
                ".foliplus-hint-LayerControl", state="attached", timeout=5000
            )
            hint_text = page.evaluate(_js("LayerControl/read_hint_text"))
            # The refusal is named by its reason: a block belongs to one role,
            # so a cross-role drag answers "same section" (the user-facing word
            # for a role) rather than naming the two roles.
            assert ("same section" in hint_text.lower()) or ("同分组" in hint_text)

    def test_dragdrop_relocates_only_the_id_match_row(self, browser, tmp_path):
        """handleDrop resolves the drop target by data-layer-id: a DOM-position
        read would have seen a self-drop and left the registry behind the
        panel."""
        with use_page(self._make_page, browser, tmp_path, slug="dragrow") as (
            page,
            errors,
        ):
            panel_ready(page)
            state = page.evaluate(
                _js("LayerControl/drag_scrambled_dom_only_updates_correct_row")
            )
            assert state is not None, "LayerControl instance not reachable"
            # The drop actually moved the registry. A DOM-position lookup reads
            # the target at the dragged layer's own index and aborts as a
            # self-drop, leaving the registry behind the panel.
            assert state["registryMoved"] is True, (
                f"the drop aborted: the target row was resolved by DOM position, "
                f"not id (registry stayed {state['beforeRegistry']})"
            )
            # Panel and registry agree once the drop has settled.
            assert state["panelMatchesRegistry"] is True, (
                f"panel {state['domIds']} drifted from registry "
                f"{state['afterRegistry']}"
            )
            assert state["dragDisarmed"] is True
            assert not errors, f"JS errors: {errors}"
