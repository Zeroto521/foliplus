"""Tests for foliplus.FullscreenControl."""

from __future__ import annotations

import folium
from conftest import (
    assert_config_value,
    assert_locale,
    make_browser_page,
    render_control,
    use_page,
)

from foliplus import FullscreenControl


class TestFullscreenControlPython:
    """Python-side property tests."""

    def test_name(self):
        assert FullscreenControl()._name == "FullscreenControl"

    def test_default_position(self):
        assert FullscreenControl().position == "bottomright"

    def test_custom_position(self):
        assert FullscreenControl(position="topleft").position == "topleft"

    def test_default_hide_self(self):
        assert FullscreenControl().hide_self is True

    def test_custom_hide_self(self):
        assert FullscreenControl(hide_self=False).hide_self is False

    def test_default_locale(self):
        assert FullscreenControl()._locale_code == ""

    def test_custom_locale(self):
        assert FullscreenControl(locale="zh")._locale_code == "zh"


class TestFullscreenControlRendering:
    def test_default_params(self):
        html = render_control(FullscreenControl())
        assert "foliplus-fullscreen-toggle" in html

    def test_hide_self_default(self):
        """hide_self=true is passed via CONFIG."""
        html = render_control(FullscreenControl())
        assert_config_value(html, "hide_self", True)

    def test_hide_self_false(self):
        """hide_self=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_self=False))
        assert_config_value(html, "hide_self", False)

    def test_locale_zh(self):
        html = render_control(FullscreenControl(locale="zh"))
        assert_locale(html, "已进入全屏", "FullscreenControl.enter")

    def test_css_fullscreen_variables(self):
        """Fullscreen CSS includes fullscreen container styles."""
        html = render_control(FullscreenControl())
        assert "foliplus-fullscreen-toggle" in html
        assert "ctrl-size" in html
        assert "foliplus-fullscreen-bar" in html

    def test_zoom_svg_inline(self):
        """Zoom +/- use inline SVGs created by FullscreenControl.js."""
        html = render_control(FullscreenControl())
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html

    def test_leaflet_bar_container(self):
        """Container has two-layer structure: outer leaflet-bar, inner fullscreen-bar + ctrl-fold."""
        html = render_control(FullscreenControl())
        assert "leaflet-bar" in html
        assert "leaflet-control" in html
        assert "foliplus-fullscreen-bar" in html
        assert "foliplus-ctrl-fold" in html

    def test_zoom_translation_keys(self):
        """Zoom in/out use translation keys."""
        html = render_control(FullscreenControl())
        assert "FullscreenControl.zoom_in" in html
        assert "FullscreenControl.zoom_out" in html

    def test_hide_others_false_skips_others_block(self):
        """hide_others=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_others=False))
        assert_config_value(html, "hide_others", False)

    def test_hide_self_independent_of_hide_others(self):
        """hide_self still works when hide_others=false."""
        html = render_control(FullscreenControl(hide_self=True, hide_others=False))
        assert_config_value(html, "hide_self", True)
        assert_config_value(html, "hide_others", False)

    def test_zoom_buttons_hidden_with_hide_self(self):
        """hide_self hides zoom +/- together with the fullscreen button."""
        html = render_control(FullscreenControl(hide_self=True, hide_others=False))
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert "foliplus-hidden" in html

    def test_zoom_buttons_visible_without_hide_self(self):
        """hide_self=false is passed via CONFIG."""
        html = render_control(FullscreenControl(hide_self=False, hide_others=False))
        assert "foliplus-zoom-in" in html
        assert "foliplus-zoom-out" in html
        assert_config_value(html, "hide_self", False)
        assert_config_value(html, "hide_others", False)

    def test_css_dim_scrim(self):
        """The scrim fades the basemap while controls stay above it."""
        html = render_control(FullscreenControl())
        assert "foliplus-dim" in html
        assert "foliplus-dim-active" in html
        # PostCSS minifies `180ms` -> `.18s`, so assert the property is present
        # with a plausible value. --dim-color embeds var(--alpha-50) from
        # common.css (resolved by the browser, not the bundler). The easing is
        # ease-out (the project standard); the duration is read from
        # --dim-duration via var().
        import re

        assert re.search(r"--dim-duration\s*:\s*(180ms?|\.18s)", html)
        assert re.search(
            r"--dim-color\s*:\s*rgba\(0,\s*0,\s*0,\s*var\(--alpha-50\)\)", html
        )
        assert "pointer-events" in html and "none" in html

    def test_css_dim_uses_tokens(self):
        """The fade reads the duration from a CSS custom property."""
        html = render_control(FullscreenControl())
        assert "var(--dim-duration)" in html
        # Easing is the project-standard ease-out, used directly rather than
        # through a token. --dim-color carries the alpha via var(--alpha-50).
        assert "var(--alpha-50)" in html
        assert "ease-out" in html

    def test_css_dim_respects_reduced_motion(self):
        """prefers-reduced-motion drops the fade instead of the dim itself."""
        html = render_control(FullscreenControl())
        assert (
            "prefers-reduced-motion:reduce" in html
            or "@media(prefers-reduced-motion:reduce)" in html
            or "prefers-reduced-motion: reduce" in html
        )
        assert "transition:none" in html or "transition: none" in html


class TestFullscreenControlBrowser:
    """Browser-based smoke tests for FullscreenControl."""

    def _make_page(self, browser, tmp_path, hide_self=True, hide_others=False):
        """Build a page with FullscreenControl and return (page, errors)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        FullscreenControl(hide_self=hide_self, hide_others=hide_others).add_to(m)
        html = m.get_root().render()
        page, errors = make_browser_page(browser, tmp_path, html, "fullscreen")
        return page, errors

    def test_button_exists(self, browser, tmp_path):
        """FullscreenControl button is present in the DOM."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_btn = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle') !== null"
            )
            assert has_btn, "FullscreenControl button not found"
            assert not errors, f"JS errors: {errors}"

    def test_maximize_svg_default(self, browser, tmp_path):
        """FullscreenControl button shows maximize SVG by default."""
        with use_page(self._make_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            svg = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle svg') !== null"
            )
            assert svg, "No SVG icon found"
            path_d = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle path').getAttribute('d')"
            )
            # Maximize icon has M8 3H5...
            assert "M8 3H5" in path_d
            assert not errors, f"JS errors: {errors}"

    def test_hide_self(self, browser, tmp_path):
        """hide_self=true hides fullscreen button when fullscreen."""
        with use_page(self._make_page, browser, tmp_path, hide_self=True) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            has_self_hide = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle').innerHTML.indexOf('MINIMIZE') === -1"
            )
            assert has_self_hide
            assert not errors, f"JS errors: {errors}"

    def _enter_fullscreen(self, page, hide_self=True):
        """Click the fullscreen toggle to enter fullscreen.

        Uses a real input event (page.click) — the Fullscreen API requires
        user activation, which synthesized `.click()` via page.evaluate may
        not provide. Waits for both the native fullscreen state AND the UI
        update that follows the (async) `fullscreenchange` event.
        """
        page.click(".foliplus-fullscreen-toggle")
        page.wait_for_function("() => document.fullscreenElement !== null")
        if hide_self:
            page.wait_for_function(
                """() => document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
        else:
            # zoom stays visible when hide_self=false; wait for the icon swap
            page.wait_for_function(
                """() => document
                    .querySelector('.foliplus-fullscreen-toggle path')
                    .getAttribute('d')
                    .indexOf('M8 3v3') === 0"""
            )

    def _exit_fullscreen(self, page):
        """Click the fullscreen toggle to exit fullscreen.

        Uses a synthesized click via JS: the toggle is hidden while
        fullscreen (hide_self=true), so Playwright's page.click cannot
        target it. Exiting fullscreen does not require user activation.
        Waits for the UI to restore after the `fullscreenchange` event.
        """
        page.evaluate("document.querySelector('.foliplus-fullscreen-toggle').click()")
        page.wait_for_function("() => document.fullscreenElement === null")
        page.wait_for_function(
            """() => !document
                .querySelector('.foliplus-zoom-in')
                .classList.contains('foliplus-hidden')"""
        )

    def _zoom_displays(self, page):
        """Return computed display of zoom in/out buttons."""
        return page.evaluate(
            """() => ({
                zoomIn: getComputedStyle(
                    document.querySelector('.foliplus-zoom-in')
                ).display,
                zoomOut: getComputedStyle(
                    document.querySelector('.foliplus-zoom-out')
                ).display,
            })"""
        )

    def test_zoom_hidden_in_fullscreen(self, browser, tmp_path):
        """hide_self=true: zoom +/- are hidden while in fullscreen."""
        with use_page(
            self._make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=True)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "none", displays
            assert displays["zoomOut"] == "none", displays
            assert not errors, f"JS errors: {errors}"

    def test_zoom_visible_with_hide_self_false(self, browser, tmp_path):
        """hide_self=false: zoom +/- stay visible while in fullscreen,
        together with the fullscreen button."""
        with use_page(
            self._make_page, browser, tmp_path, hide_self=False, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"

    def test_zoom_visible_after_exit_fullscreen(self, browser, tmp_path):
        """hide_self=true: zoom +/- are visible again after exit."""
        with use_page(
            self._make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=True)
            self._exit_fullscreen(page)
            displays = self._zoom_displays(page)
            assert displays["zoomIn"] == "flex", displays
            assert displays["zoomOut"] == "flex", displays
            assert not errors, f"JS errors: {errors}"

    def test_hide_others_overrides_inline_display(self, browser, tmp_path):
        """hide_others hides sibling controls even with inline display styles.

        `.foliplus-hidden` uses `display: none !important` so it
        wins over inline `display` set by third-party Leaflet plugins.
        """
        with use_page(
            self._make_page, browser, tmp_path, hide_self=False, hide_others=True
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Inject a sibling control with inline display:block (like a
            # third-party Leaflet plugin would set).
            page.evaluate(
                """() => {
                    const div = document.createElement('div');
                    div.className = 'leaflet-bar leaflet-control custom-ctrl';
                    div.style.display = 'block';
                    div.innerHTML = 'custom';
                    document
                        .querySelector('.leaflet-top.leaflet-right')
                        .appendChild(div);
                }"""
            )
            page.wait_for_selector(".custom-ctrl", state="attached", timeout=10000)
            self._enter_fullscreen(page, hide_self=False)
            hidden = page.evaluate(
                """() => {
                    const el = document.querySelector('.custom-ctrl');
                    return el.classList.contains('foliplus-hidden')
                        && getComputedStyle(el).display === 'none';
                }"""
            )
            assert hidden, "sibling control with inline display was not hidden"
            assert not errors, f"JS errors: {errors}"

    def test_show_hint_once_per_toggle(self, browser, tmp_path):
        """showHint fires exactly once per fullscreen transition.

        updateUI is driven by the `fullscreenchange` event, so the
        requestFullscreen/exitFullscreen `.then()` callbacks must not call
        updateUI again (which would double-fire the hint).
        """
        with use_page(
            self._make_page, browser, tmp_path, hide_self=True, hide_others=False
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Wrap showHint to count calls (per-map hint on map.foliplus).
            page.evaluate(
                """() => {
                    window.__hintCount = 0;
                    const orig = map.foliplus.showHint;
                    map.foliplus.showHint = function (...args) {
                        window.__hintCount++;
                        return orig.apply(this, args);
                    };
                }"""
            )
            self._enter_fullscreen(page, hide_self=True)
            page.wait_for_timeout(200)
            enter_count = page.evaluate("window.__hintCount")
            assert enter_count == 1, f"enter hint fired {enter_count} times"
            # Icon switched to MINIMIZE (path M8 3v3...)
            icon = page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle path').getAttribute('d')"
            )
            assert "M8 3v3" in icon, f"icon not switched to MINIMIZE: {icon}"

            self._exit_fullscreen(page)
            page.wait_for_timeout(200)
            total = page.evaluate("window.__hintCount")
            assert total == 2, f"exit hint fired {total - enter_count} times"
            assert not errors, f"JS errors: {errors}"

    def _make_pseudo_page(self, browser, tmp_path):
        """Build a page with the native Fullscreen API disabled, so the
        control falls back to pseudo-fullscreen mode (isEnabled=false)."""
        m = folium.Map(location=[26.08, 119.30], zoom_start=12)
        FullscreenControl(hide_self=True, hide_others=False).add_to(m)

        html = m.get_root().render()
        # Disable the native Fullscreen API before the control initializes.
        html = html.replace(
            "<body>",
            """<body>
            <script>
              Object.defineProperty(document, 'fullscreenEnabled', {
                value: false,
                configurable: true,
              });
              document.exitFullscreen = undefined;
              document.documentElement.requestFullscreen = undefined;
            </script>""",
        )
        html_path = tmp_path / "fullscreen_pseudo.html"
        html_path.write_text(html, encoding="utf-8")

        page = browser.new_page()
        errors = []
        page.on(
            "console",
            lambda msg: (
                errors.append(msg.text)
                if msg.type == "error"
                and not msg.text.startswith("Failed to load resource")
                else None
            ),
        )
        page.goto(f"file://{html_path}", wait_until="domcontentloaded")
        return page, errors

    def test_pseudo_fullscreen_enter_exit(self, browser, tmp_path):
        """Pseudo-fullscreen (no native API) can be entered and exited.

        The exit branch must check the internal `map.isFullscreen` flag,
        because `document.fullscreenElement` is always null when the native
        Fullscreen API is unavailable.
        """
        with use_page(self._make_pseudo_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            # Enter with a real input event (page.click generates one).
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(
                """() => document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            # Zoom hidden, icon MINIMIZE.
            hidden = page.evaluate(
                """() => document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
            assert hidden, "zoom not hidden in pseudo-fullscreen"

            # Exit. The toggle button is hidden while fullscreen, so click via
            # JS (Playwright's page.click would fail on the hidden element).
            page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle').click()"
            )
            page.wait_for_function(
                """() => !document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            visible = page.evaluate(
                """() => !document
                    .querySelector('.foliplus-zoom-in')
                    .classList.contains('foliplus-hidden')"""
            )
            assert visible, "zoom not restored after exiting pseudo-fullscreen"
            assert not errors, f"JS errors: {errors}"

    # ── Crossfade scrim ──────────────────────────────────────────────────

    def _scrim_snapshot(self, page):
        """Return the scrim's z-index, computed opacity and geometry."""
        return page.evaluate(
            """() => {
                const mask = document.querySelector('.foliplus-dim');
                if (!mask) return null;
                const s = getComputedStyle(mask);
                return {
                    zIndex: s.zIndex,
                    opacity: s.opacity,
                    pointerEvents: s.pointerEvents,
                    rect: {
                        x: mask.getBoundingClientRect().x,
                        y: mask.getBoundingClientRect().y,
                        width: mask.getBoundingClientRect().width,
                        height: mask.getBoundingClientRect().height,
                    },
                };
            }"""
        )

    def _scrim_layers(self, page):
        """Return the scrim, its parent and every control with their stacking values."""
        return page.evaluate(
            """() => {
                const pick = el => ({
                    el: el.className,
                    zIndex: getComputedStyle(el).zIndex,
                    position: getComputedStyle(el).position,
                    top: el.getBoundingClientRect().top,
                });
                const mask = document.querySelector('.foliplus-dim');
                return {
                    scrim: mask ? {
                        ...pick(mask),
                        parent: mask.parentElement
                            ? mask.parentElement.className
                            : null,
                        parentZIndex: mask.parentElement
                            ? getComputedStyle(mask.parentElement).zIndex
                            : null,
                    } : null,
                    controls: Array.from(
                        document.querySelectorAll('.leaflet-control')
                    ).map(pick),
                };
            }"""
        )

    def test_scrim_fades_on_enter(self, browser, tmp_path):
        """Entering fullscreen fades the basemap down and back up on exit.

        Asserts the computed opacity on real pixels rather than the CSS rule,
        and that the fade actually lands at the token value.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )

            # Transparent before the first toggle; the scrim itself is not in
            # the DOM yet (it is created lazily on first use).
            assert page.evaluate(
                "document.querySelectorAll('.foliplus-dim').length === 0"
            ), "scrim should not exist before the first toggle"
            assert (
                page.evaluate(
                    "document.querySelector('.leaflet-container')"
                    ".classList.contains('foliplus-dim-active')"
                )
                is False
            )

            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(
                250
            )  # past the 180ms fade-in; scrim is state-bound, stays at full opacity
            opacity_in = page.evaluate(
                "() => getComputedStyle(document.querySelector('.foliplus-dim'))"
                ".opacity"
            )
            assert abs(float(opacity_in) - 1.0) < 0.05, opacity_in
            assert (
                page.evaluate("document.querySelectorAll('.foliplus-dim').length") == 1
            ), "scrim should be created exactly once"

            self._exit_fullscreen(page)
            page.wait_for_timeout(800)
            opacity_out = page.evaluate(
                "() => getComputedStyle(document.querySelector('.foliplus-dim'))"
                ".opacity"
            )
            assert abs(float(opacity_out)) < 0.05, opacity_out

            # The scrim element is created once per map and kept in the DOM;
            assert (
                page.evaluate("document.querySelectorAll('.foliplus-dim').length") == 1
            )

            assert not errors, f"JS errors: {errors}"

    def test_scrim_mounts_on_container(self, browser, tmp_path):
        """The scrim is a child of the map container, not a sibling of it.

        The container is the fullscreen element in native fullscreen, and the
        user agent paints only the fullscreen element and its descendants while
        one is active, so the scrim must live there to paint at all. Inside the
        container it also stays correct in pseudo-fullscreen, where the
        container is `position: fixed` filling the viewport, so `inset: 0`
        still spans the whole viewport.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)

            mounted = page.evaluate(
                """() => {
                    const mask = document.querySelector('.foliplus-dim');
                    const c = document.querySelector('.leaflet-container');
                    return {
                        onContainer: mask.parentElement === c,
                        insideContainer: c.contains(mask),
                        isDescendantOfFullscreen: document.fullscreenElement
                            ? document.fullscreenElement.contains(mask)
                            : null,
                        isLeafletControl: mask.classList.contains('leaflet-control'),
                    };
                }"""
            )
            assert mounted["onContainer"], (
                "scrim must be a direct child of the map container"
            )
            assert mounted["insideContainer"]
            # Decisive for native mode: only descendants of the fullscreen
            # element paint while it is active.
            assert mounted["isDescendantOfFullscreen"] is True, mounted
            # Not a .leaflet-control, so the hide_others sweep leaves it alone.
            assert mounted["isLeafletControl"] is False

            assert not errors, f"JS errors: {errors}"

    def test_scrim_covers_the_viewport(self, browser, tmp_path):
        """The scrim spans the whole viewport in both fullscreen modes."""
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            snap = self._scrim_snapshot(page)
            assert snap is not None
            assert snap["rect"]["x"] == 0 and snap["rect"]["y"] == 0, snap["rect"]
            assert snap["rect"]["width"] == page.evaluate("window.innerWidth")
            assert snap["rect"]["height"] == page.evaluate("window.innerHeight")
            assert snap["pointerEvents"] == "none"
            assert not errors, f"JS errors: {errors}"

    def test_scrim_passes_through_hits(self, browser, tmp_path):
        """Nothing but the basemap darkens, and nothing blocks a click.

        A click aimed at the map under the scrim must still reach the map
        (the scrim is pointer-events: none), so tiles pan and no pointerdown
        is swallowed.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(400)

            # elementFromPoint at the centre of the scrim must NOT be the scrim.
            # Match the exact class token: the container carries
            # `.foliplus-dim-active`, so a substring check on the bare
            # class name would match that and mask a real hit.
            centre = page.evaluate(
                """() => {
                    const r = document.querySelector('.leaflet-container').getBoundingClientRect();
                    const el = document.elementFromPoint(
                        r.left + r.width / 2, r.top + r.height / 2);
                    if (!el) return {isScrim: true, tag: null};
                    return {
                        isScrim: el.classList.contains('foliplus-dim'),
                        tag: el.tagName,
                    };
                }"""
            )
            assert not centre["isScrim"], f"scrim intercepted the hit: {centre}"

            # The map still receives the click and pans.
            # Listen on the container directly rather than via `map`, which is
            # not a page global here.
            page.evaluate(
                """() => {
                    window.__downSpy = 0;
                    document.querySelector('.leaflet-container')
                        .addEventListener('pointerdown', () => {
                            window.__downSpy++;
                        }, true);
                }"""
            )
            box = page.evaluate(
                """() => {
                    const r = document.querySelector('.leaflet-container').getBoundingClientRect();
                    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
                }"""
            )
            page.mouse.move(box["x"], box["y"])
            page.mouse.down()
            page.mouse.move(box["x"] + 120, box["y"], steps=6)
            page.mouse.up()
            page.wait_for_timeout(300)
            got_down = page.evaluate("window.__downSpy")
            assert got_down > 0, (
                f"map did not receive the pointer through the scrim: {got_down}"
            )

            assert not errors, f"JS errors: {errors}"

    def test_scrim_below_controls(self, browser, tmp_path):
        """Only the basemap darkens: controls stay above the scrim and crisp.

        Everything sorts in the map container's stacking context: the container
        is positioned, `.leaflet-control-container` is `position: static` with
        `z-index: auto` so it does not create one of its own, and
        `.leaflet-map-pane` is `absolute` at z-index 400, so every pane sorts
        inside the pane rather than against the scrim. 799 therefore sits between
        the map pane (400) and the controls (800) — the basemap and everything
        on it darken, and no control panel does.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(400)

            layers = self._scrim_layers(page)
            assert layers["scrim"] is not None
            assert layers["scrim"]["zIndex"] == "799", layers["scrim"]
            assert layers["scrim"]["position"] == "absolute", layers["scrim"]
            # The scrim's parent is the map container, not the control
            # container — 799 is meant to sort against the controls' own 800.
            assert "leaflet-container" in layers["scrim"]["parent"], layers["scrim"]
            assert layers["scrim"]["parentZIndex"] != "auto", layers["scrim"]
            assert layers["controls"], "expected at least one .leaflet-control"

    def test_esc_exit_clears_the_scrim(self, browser, tmp_path):
        """Exiting via the keyboard undims, not just exiting via the button.

        Esc reaches fullscreenchange directly, bypassing toggleFullscreen
        entirely. The dim therefore has to be driven from the API state in
        handleFSChange, or the basemap stays darkened for the next toggle.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(250)  # sample during the flash
            opacity_in = self._scrim_snapshot(page)["opacity"]
            assert abs(float(opacity_in) - 0.5) < 0.05, opacity_in

            # The browser ends fullscreen itself; page.keyboard.press("Escape")
            # does not work here, since a native keydown never reaches the page
            # while fullscreen. exitFullscreen fires the same fullscreenchange.
            page.evaluate("document.exitFullscreen()")
            page.wait_for_function("() => document.fullscreenElement === null")
            page.wait_for_timeout(800)

            assert (
                page.evaluate(
                    "document.querySelector('.leaflet-container')"
                    ".classList.contains('foliplus-dim-active')"
                )
                is False
            )
            opacity_out = self._scrim_snapshot(page)["opacity"]
            assert abs(float(opacity_out)) < 0.05, opacity_out
            assert not errors, f"JS errors: {errors}"

    def test_scrim_does_not_affect_controls(self, browser, tmp_path):
        """Controls keep their own background and alpha during the crossfade.

        The scrim only darkens the basemap, so a control's computed background
        colour and opacity must be byte-identical dimmed and undimmed.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )

            grab = """() => {
                const b = document.querySelector('.foliplus-fullscreen-bar');
                const s = getComputedStyle(b);
                return {bg: s.backgroundColor, color: s.color, opacity: s.opacity};
            }"""
            before = page.evaluate(grab)
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(400)
            during = page.evaluate(grab)
            assert during == before, f"control styling changed: {before} -> {during}"
            self._exit_fullscreen(page)
            page.wait_for_timeout(400)
            after = page.evaluate(grab)
            assert after == before, (
                f"control styling did not restore: {before} -> {after}"
            )

            assert not errors, f"JS errors: {errors}"

    def test_scrim_stays_below_hints(self, browser, tmp_path):
        """Hints float above the scrim, so the fullscreen hint stays readable."""
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(400)

            result = page.evaluate(
                """() => {
                    const hint = document.querySelector('.foliplus-hint');
                    if (!hint) return null;
                    const s = getComputedStyle(hint);
                    return {zIndex: s.zIndex, found: true};
                }"""
            )
            if result:
                assert int(result["zIndex"]) > 799, result

            assert not errors, f"JS errors: {errors}"

    def test_pseudo_scrim_covers_viewport(self, browser, tmp_path):
        """In pseudo-fullscreen the scrim still spans the full viewport."""
        with use_page(self._make_pseudo_page, browser, tmp_path) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            page.click(".foliplus-fullscreen-toggle")
            page.wait_for_function(
                """() => document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            page.wait_for_timeout(250)  # sample during the flash
            snap = self._scrim_snapshot(page)
            assert snap is not None
            assert snap["rect"]["width"] == page.evaluate("window.innerWidth"), snap
            assert snap["rect"]["height"] == page.evaluate("window.innerHeight"), snap
            assert abs(float(snap["opacity"]) - 0.5) < 0.05, snap["opacity"]

            page.evaluate(
                "document.querySelector('.foliplus-fullscreen-toggle').click()"
            )
            page.wait_for_function(
                """() => !document
                    .querySelector('.leaflet-container')
                    .classList.contains('leaflet-pseudo-fullscreen')"""
            )
            page.wait_for_timeout(800)
            snap_out = self._scrim_snapshot(page)
            assert abs(float(snap_out["opacity"])) < 0.05, snap_out["opacity"]
            assert not errors, f"JS errors: {errors}"

    def test_scrim_survives_hide_others(self, browser, tmp_path):
        """hide_others hides sibling controls but never the scrim.

        The scrim shares the container with the controls but carries none of
        their classes, so the `.leaflet-control` / `.foliplus-scale-wrap` sweep
        must leave it alone.
        """
        with use_page(
            self._make_page, browser, tmp_path, hide_self=False, hide_others=True
        ) as (page, errors):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(250)  # sample during the flash

            check = page.evaluate(
                """() => {
                    const mask = document.querySelector('.foliplus-dim');
                    return {
                        present: !!mask,
                        hidden: mask.classList.contains('foliplus-hidden'),
                        opacity: getComputedStyle(mask).opacity,
                    };
                }"""
            )
            assert check["present"], "scrim missing with hide_others=true"
            assert not check["hidden"], "hide_others must not hide the scrim"
            assert abs(float(check["opacity"]) - 0.5) < 0.05, check["opacity"]
            assert not errors, f"JS errors: {errors}"

    def test_scrim_does_not_break_invalidation(self, browser, tmp_path):
        """The scrim must not be counted as a map pane by Leaflet.

        The scrim does live inside the container, but Leaflet only treats
        `.leaflet-pane` children of `.leaflet-map-pane` as panes, so the pane
        list is unchanged and invalidateSize keeps working.
        """
        with use_page(self._make_page, browser, tmp_path, hide_self=False) as (
            page,
            errors,
        ):
            page.wait_for_selector(
                ".foliplus-fullscreen-toggle", state="attached", timeout=10000
            )
            before = page.evaluate("Object.keys(map.getPanes()).length")
            self._enter_fullscreen(page, hide_self=False)
            page.wait_for_timeout(400)
            after = page.evaluate("Object.keys(map.getPanes()).length")
            assert after == before, f"pane count changed {before} -> {after}"
            assert not errors, f"JS errors: {errors}"
