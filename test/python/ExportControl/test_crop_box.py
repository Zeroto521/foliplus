"""Crop-box UI interaction tests for foliplus.ExportControl."""

from __future__ import annotations

import pytest
from conftest import _js, use_page

from .helper import _make_page


class TestExportCropBoxBrowser:
    """Browser tests for the ExportControl crop-box UI (open/lock/keyboard/resize)."""

    def test_remove_readd_rebuilds_manager(self, browser, tmp_path):
        """removeControl + addControl re-attaches export UI on a fresh manager."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            state = page.evaluate(_js("ExportControl/destroy_readd"))
            assert state["removed"] is True
            assert state["hasManager"] is True
            assert state["attached"] is True
            assert not errors, f"JS errors: {errors}"

    def test_toggle_button_present(self, browser, tmp_path):
        """Export toggle button is rendered and clickable."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            btn = page.wait_for_selector(
                ".foliplus-export-ctrl .foliplus-toggle-btn",
                state="attached",
                timeout=10000,
            )
            assert btn is not None, "Export toggle button not found"

    def test_crop_box_appears_on_click(self, browser, tmp_path):
        """Clicking toggle button shows the crop box."""

        with use_page(_make_page, browser, tmp_path) as (page, _):
            btn = page.locator(".foliplus-export-ctrl .foliplus-toggle-btn")
            btn.click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box").is_visible()
            assert page.locator(".foliplus-export-overlay").is_visible()
            assert page.locator(".foliplus-export-handle").count() == 8

    def test_anchor_dots_share_the_dot_token_geometry(self, browser, tmp_path):
        """Handle and center anchors match the shared --foliplus-dot-size.

        Pins the visual equivalence that the dot-token unification promises:
        every interactive anchor dot is a circle of the same outer diameter,
        sized by the single token, with border-box so the ring sits inside.
        Chromium snaps border-width to whole device pixels (2.5px -> 2px at
        dpr 1); the outer diameter is what must stay equal.
        """

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            info = page.evaluate(_js("ExportControl/read_anchor_dots_geometry"))
            handle, center = info["handle"], info["center"]
            # Outer diameter comes from the shared token (12.5px default).
            # Tight tolerance: a regression to 12px or 13px must fail.
            assert abs(handle["w"] - 12.5) < 0.1, handle
            assert abs(center["w"] - 12.5) < 0.1, center
            # Both are circles, not rectangles.
            assert abs(handle["w"] - handle["h"]) < 0.01, handle
            assert abs(center["w"] - center["h"]) < 0.01, center
            # Ring sits inside the box (border-box from .foliplus-dot).
            assert handle["boxSizing"] == "border-box", handle
            assert center["boxSizing"] == "border-box", center
            # Handle and center agree — one token, one geometry.
            assert abs(handle["w"] - center["w"]) < 0.01, (handle, center)

    def test_export_center_hover_does_not_move(self, browser, tmp_path):
        """Hovering the crop center must not shift its position.

        scale() composed with the permanent translate(-50%, -50%) used to
        nudge the dot on hover. Rest and hover boxes must agree; only the
        glow/shadow may change.
        """

        def _box(locator):
            return locator.bounding_box()

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            center = page.locator(".foliplus-export-center")
            rest = _box(center)
            assert rest and rest["width"] > 0, rest
            center.hover()
            page.wait_for_timeout(200)  # let any shadow transition settle
            hover = _box(center)
            assert hover, "center disappeared while hovered"
            # Position and size must be identical — a scale() would change
            # width/height and usually left/top as well.
            assert abs(hover["x"] - rest["x"]) < 0.05, (rest, hover)
            assert abs(hover["y"] - rest["y"]) < 0.05, (rest, hover)
            assert abs(hover["width"] - rest["width"]) < 0.05, (rest, hover)
            assert abs(hover["height"] - rest["height"]) < 0.05, (rest, hover)

    def test_export_anchor_border_radius_is_round(self, browser, tmp_path):
        """Crop handle/center computed border-radius is the round token (50%).

        A square 12×12 box with accent-light hover wash and glow/focus-ring
        projects hard corners; both anchors must compute as circles.
        """

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            radii = page.evaluate(_js("ExportControl/read_anchor_border_radius"))
            # --foliplus-radius-round is 50%; both square boxes must resolve to it.
            assert radii["handle"] == "50%", radii
            assert radii["center"] == "50%", radii

    def test_export_handle_hover_corners_are_not_square(self, browser, tmp_path):
        """Hovering a handle paints a circle: corner pink density < center.

        accent-light is a soft red (#fde8e8). On a round button the four
        bounding-box corners sit outside the fill; a square box would fill
        them solid pink.
        """
        import io as _io

        from PIL import Image

        def _corner_pink(shot: bytes, inset: int = 0):
            img = Image.open(_io.BytesIO(shot)).convert("RGBA")
            w, h = img.size
            pts = [
                (inset, inset),
                (w - 1 - inset, inset),
                (inset, h - 1 - inset),
                (w - 1 - inset, h - 1 - inset),
            ]
            pink = 0
            for x, y in pts:
                r, g, b, a = img.getpixel((x, y))
                # accent-light ≈ #fde8e8 → high R, pink G/B, opaque fill.
                if a > 200 and r > 240 and 200 <= g <= 240 and 200 <= b <= 240:
                    pink += 1
            cx, cy = w // 2, h // 2
            r, g, b, a = img.getpixel((cx, cy))
            center_pink = a > 200 and r > 240 and 200 <= g <= 240 and 200 <= b <= 240
            return pink, center_pink, (w, h)

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            handle = page.locator(".foliplus-export-handle.br")
            handle.hover()
            page.wait_for_timeout(200)
            shot = handle.screenshot()
            corner_pink, center_pink, size = _corner_pink(shot)
            assert center_pink, f"handle center should be accent-light: size={size}"
            # Round clip: corners outside the circle must not be solid pink.
            assert corner_pink < 4, (
                f"handle hover painted square corners: corner_pink={corner_pink} "
                f"center_pink={center_pink} size={size}"
            )

    def test_escape_closes_crop_box(self, browser, tmp_path):
        """Pressing Escape with unlocked crop box removes it."""

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Verify crop box is visible
            assert page.locator(".foliplus-export-box").is_visible()
            # Press Escape
            page.keyboard.press("Escape")
            # Crop box should disappear
            page.wait_for_selector(
                ".foliplus-export-box",
                state="hidden",
                timeout=5000,
            )

    def test_crop_selecting_disables_other_layer_interaction(self, browser, tmp_path):
        """Crop selection suspends interaction on other map layers (clicks fall
        through to drag the crop box instead of firing feature handlers), and
        closing the crop box restores it."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.evaluate(
                "window.__featureMarker = L.marker([26.08, 119.30]).addTo(window.__map).bindPopup('x');"
            )
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True

            # Open crop selection → the centralized ModeManager lock disables the marker.
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(300)
            assert (
                page.evaluate(
                    "window.__exportManager.map.foliplus.modes.getMode('ExportControl')"
                )
                == "selecting"
            )
            assert page.evaluate("window.__featureMarker.options.interactive") is False

            # A DOM click on the marker's icon must NOT open its popup while the
            # crop box owns the map.
            page.evaluate(
                "window.__featureMarker.getElement().dispatchEvent(new MouseEvent('click', { bubbles: true }))"
            )
            page.wait_for_timeout(300)
            popup_open = page.evaluate("!!document.querySelector('.leaflet-popup')")
            assert not popup_open, "feature popup opened during crop selection"

            # Close the crop box (Escape) → interaction restored.
            page.keyboard.press("Escape")
            page.wait_for_selector(".foliplus-export-box", state="hidden", timeout=5000)
            page.wait_for_timeout(300)
            assert page.evaluate("window.__featureMarker.options.interactive") is True
            assert not errors, f"JS errors: {errors}"

    def test_enter_locks_crop_box(self, browser, tmp_path):
        """Pressing Enter locks the crop box (dashed > solid border)."""

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Lock via confirm button
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box.foliplus-locked").is_visible()

    def test_arrow_keys_nudge_crop_box(self, browser, tmp_path):
        """Arrow keys nudge the unlocked crop box by NUDGE_STEP without panning."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            # The arrow shortcuts are container-bound — focus the map container.
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            rect0 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center0 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            rect1 = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top }; }"
            )
            center1 = page.evaluate(
                "() => { const c = window.__map.getCenter(); return [c.lat, c.lng]; }"
            )
            # Box moved by NUDGE_STEP in both axes; the map must NOT pan
            # (Leaflet's built-in arrow-key handler is disabled while editing).
            assert rect1["l"] == pytest.approx(rect0["l"] + 3)
            assert rect1["t"] == pytest.approx(rect0["t"] + 3)
            assert center1 == center0

    def test_nudge_tracks_key_without_reanimating_hint(self, browser, tmp_path):
        """Holding an arrow key tracks each press and leaves the size hint alone."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            # Tag the size-hint element so we can detect if it gets rebuilt.
            page.evaluate(
                "() => { document.querySelector('.foliplus-hint-ExportControl-size')"
                ".setAttribute('data-mark', '1'); }"
            )
            before = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, w: r.width, h: r.height }; }"
            )

            # Simulate a held key: one keydown starts the smooth-nudge loop,
            # then OS auto-repeat fires repeated keydowns for the same key.
            # With the loop running the repeats are intentionally ignored, so
            # a held key nudges exactly once (the loop's sync frame) plus the
            # continuous stream handled by the loop — here the test injects a
            # no-op scheduler so the loop only ever runs its sync frame, i.e.
            # one NUDGE_STEP regardless of how many repeats follow.
            page.keyboard.down("ArrowRight")
            for _ in range(4):
                page.evaluate(
                    "() => document.dispatchEvent(new KeyboardEvent('keydown', "
                    "{ key: 'ArrowRight', bubbles: true }))"
                )

            # The box suppresses its transition while nudging, so it tracks the
            # keystrokes instead of chasing them (a transition would make the
            # box lag behind and only settle after the key is released).
            box = page.locator(".foliplus-export-box")
            assert box.get_attribute("class").endswith("dragging")
            after = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, w: r.width, h: r.height }; }"
            )
            # Repeats are ignored while the loop runs -> exactly one NUDGE_STEP.
            assert after["l"] == pytest.approx(before["l"] + 3)
            assert after["w"] == pytest.approx(before["w"])
            assert after["h"] == pytest.approx(before["h"])

            # A pure move keeps the size constant, so the hint is never refreshed —
            # refreshing would rebuild the element and replay its entry animation.
            assert (
                page.evaluate(
                    "() => document.querySelector('.foliplus-hint-ExportControl-size')"
                    ".getAttribute('data-mark')"
                )
                == "1"
            )

            # Releasing the key restores the transition.
            page.keyboard.up("ArrowRight")
            page.wait_for_timeout(50)
            assert not box.get_attribute("class").endswith("dragging")

            # R changes the size, so the hint must be refreshed (and rebuilt).
            page.keyboard.press("r")
            page.wait_for_timeout(150)
            assert (
                page.evaluate(
                    "() => document.querySelector('.foliplus-hint-ExportControl-size')?"
                    ".getAttribute('data-mark')"
                )
                != "1"
            )

    def test_r_resets_crop_box(self, browser, tmp_path):
        """R resets the unlocked crop box to the default centered size."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            default = page.evaluate(
                "() => { const r = window.__exportManager.defaultRect(); "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            page.evaluate(
                "() => { const c = window.__map.getContainer(); "
                "c.setAttribute('tabindex', '-1'); c.focus(); }"
            )
            # Nudge away from default so a reset is observable.
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowRight")
            page.keyboard.press("ArrowDown")
            moved = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert moved != default, "expected box to move before reset"
            page.keyboard.press("r")
            after = page.evaluate(
                "() => { const r = window.__exportManager.cropState.rect; "
                "return { l: r.left, t: r.top, w: r.width, h: r.height }; }"
            )
            assert after == pytest.approx(default)

    def test_export_mode_class(self, browser, tmp_path):
        """foliplus-export-mode class is added to body and map container."""

        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box",
                state="attached",
                timeout=5000,
            )
            # Check export mode class on body
            has_mode = page.evaluate(
                "document.body.classList.contains('foliplus-export-mode')"
            )
            assert has_mode, "body should have foliplus-export-mode class"
            # Check on map container
            has_map_mode = page.evaluate(_js("ExportControl/read_export_mode_class"))
            assert has_map_mode, "map container should have foliplus-export-mode"

    def test_lock_unlock_cycle(self, browser, tmp_path):
        """Lock then unlock crop box transitions correctly."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Lock
            page.locator(".foliplus-tool-bar .foliplus-confirm").click()
            page.wait_for_selector(
                ".foliplus-export-box.foliplus-locked", state="attached", timeout=5000
            )
            assert page.locator(".foliplus-export-box.foliplus-locked").is_visible()

            # Unlock (cancel resets to unlocked)
            page.locator(".foliplus-tool-bar .foliplus-cancel").click()
            page.wait_for_selector(
                ".foliplus-export-box:not(.foliplus-locked)",
                state="attached",
                timeout=5000,
            )
            assert page.locator(".foliplus-export-box").is_visible()

    def test_no_console_errors_on_open(self, browser, tmp_path):
        """Opening export control should not produce JS errors."""
        with use_page(_make_page, browser, tmp_path) as (page, errors):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )
            page.wait_for_timeout(500)
            assert len(errors) == 0, f"JS errors on open: {errors}"

    def test_crop_box_drag_resize(self, browser, tmp_path):
        """Dragging a crop box handle resizes the box."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            # Get initial box size and the br handle position
            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the bottom-right handle using absolute mouse coordinates
            handle = page.locator(".foliplus-export-handle.br")
            handle_box = handle.bounding_box()
            # Drag from handle center 80px right and 40px down
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2,
                handle_box["y"] + handle_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                handle_box["x"] + handle_box["width"] / 2 + 80,
                handle_box["y"] + handle_box["height"] / 2 + 40,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            assert after["w"] > initial["w"], (
                f"Expected width increased, was {initial['w']} now {after['w']}"
            )
            assert after["h"] > initial["h"], (
                f"Expected height increased, was {initial['h']} now {after['h']}"
            )

    def test_crop_box_drag_move(self, browser, tmp_path):
        """Dragging the crop box center moves the box."""
        with use_page(_make_page, browser, tmp_path) as (page, _):
            page.locator(".foliplus-export-ctrl .foliplus-toggle-btn").click()
            page.wait_for_selector(
                ".foliplus-export-box", state="attached", timeout=5000
            )

            initial = page.evaluate(_js("ExportControl/read_box_rect"))

            # Drag the center by 30px right and 20px down using raw mouse events
            center = page.locator(".foliplus-export-center")
            center_box = center.bounding_box()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2,
                center_box["y"] + center_box["height"] / 2,
            )
            page.mouse.down()
            page.mouse.move(
                center_box["x"] + center_box["width"] / 2 + 30,
                center_box["y"] + center_box["height"] / 2 + 20,
                steps=10,
            )
            page.mouse.up()
            page.wait_for_timeout(300)

            after = page.evaluate(_js("ExportControl/read_box_rect"))
            # Width/height should be unchanged
            assert after["w"] == initial["w"], (
                f"Width should not change on move, was {initial['w']} now {after['w']}"
            )
            assert after["h"] == initial["h"], (
                f"Height should not change on move, was {initial['h']} now {after['h']}"
            )
            # Position should have shifted
            assert after["l"] != initial["l"] or after["t"] != initial["t"], (
                f"Position should change on move, was ({initial['l']},{initial['t']}) now ({after['l']},{after['t']})"
            )
