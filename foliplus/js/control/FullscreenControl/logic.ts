// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONFIG / T are no longer module-level: defineControl hands them off to the
// control instance, and the entry passes an env slice into these functions.
import { setPseudoFullscreen } from "#core/fullscreen.js";
import { HINT_DURATION } from "#core/hint.js";
import { isEnabled, ownsFullscreen } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";

/** Per-call env slice the entry passes in. Same vocabulary as ControlEnv but
 *  narrowed to what this module reads — `name` and `hide_*` from CONFIG, plus
 *  the scoped translator. */
type Env = { config: ComponentConfig; T: (key: string) => string };

// ══════════════════════════════════════════════════════════════════════════════
// updateUI (internal)  —  refresh icon, title, sibling/self visibility, hint
// ══════════════════════════════════════════════════════════════════════════════
// `hintText` overrides the enter/exit wording — pseudo entries announce the
// fallback instead of claiming a native fullscreen the user may not see.
const updateUI = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
  env: Env,
  hintText?: string,
) => {
  const { config, T } = env;
  // Native fullscreen is document-global: a sibling map's session must not
  // paint this control's icon as "exit". map.isFullscreen covers pseudo mode.
  const isFull = ownsFullscreen(map.getContainer()) || map.isFullscreen;
  fsBtn.innerHTML = isFull ? SVGs.ICON_MINIMIZE : SVGs.ICON_MAXIMIZE;
  fsBtn.title = isFull ? T("title_cancel") : T("title");

  if (config.hide_others) {
    const controls = map
      .getContainer()
      .querySelectorAll(".leaflet-control, .foliplus-scale-wrap");
    const cid = containerId(config.name, config.position as string);
    for (const c of controls) {
      if (c.contains(container) || c.closest?.(`#${cid}`)) continue;
      c.classList.toggle(CLASSES.HIDDEN, isFull);
    }
  }

  if (config.hide_self) {
    const selfBtns = container.querySelectorAll(
      `.${CLASSES.TOGGLE}, .${CLASSES.ZOOM_IN}, .${CLASSES.ZOOM_OUT}`,
    );
    for (const btn of selfBtns) btn.classList.toggle(CLASSES.HIDDEN, isFull);
  }

  map.foliplus!.showHint?.(
    config.name,
    hintText ?? (isFull ? T("enter") : T("exit")),
    HINT_DURATION.MEDIUM,
  );
};

const showExitFailHint = (map: L.Map, env: Env) => {
  map.foliplus!.showHint?.(env.config.name, env.T("exit_fail"), HINT_DURATION.MEDIUM);
};

// Native fullscreen is unavailable here — embedder policy (Feishu/Notion-style
// cross-origin iframes without the fullscreen permission) or an API-less
// browser. Pseudo mode maximizes within the page, and the hint says so rather
// than announcing a fullscreen the user cannot see.
const enterPseudo = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
  env: Env,
) => {
  // Also sets map.isFullscreen: from a consumer's point of view the map covers
  // the visible area either way, and callers (including this control's own exit
  // branch) key on that flag. The flag intentionally spans native and pseudo
  // sessions; only the mechanism differs. setPseudoFullscreen() announces the
  // new surface, so overlays already on screen re-seat before the hint below
  // is appended.
  setPseudoFullscreen(map.getContainer(), true);
  map.invalidateSize();

  map.isFullscreen = true;
  updateUI(map, fsBtn, container, env, env.T("fallback"));
};

const exitPseudo = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
  env: Env,
) => {
  setPseudoFullscreen(map.getContainer(), false);
  map.invalidateSize();

  map.isFullscreen = false;
  updateUI(map, fsBtn, container, env);
};

// ══════════════════════════════════════════════════════════════════════════════
// toggleFullscreen  —  enter/exit fullscreen via native API or pseudo mode
// ══════════════════════════════════════════════════════════════════════════════
// Exit branches key on the real fullscreen state, not isEnabled(): a pseudo
// session must exit as pseudo even if permission arrived since it started.
const toggleFullscreen = (
  map: L.Map,
  fsBtn: HTMLElement,
  container: HTMLElement,
  env: Env,
) => {
  const mapContainer = map.getContainer();
  if (ownsFullscreen(mapContainer)) {
    document
      .exitFullscreen()
      .then(() => {
        map.isFullscreen = false;
        // A native transition always wins over a pseudo class: a request that
        // rejected but completed natively, or a permission flip mid-session,
        // can leave both states on the container. Clear pseudo here so
        // fullscreenSurface() stops treating the container as a surface after
        // the native session ends.
        setPseudoFullscreen(mapContainer, false);
      })
      .catch(() => {
        map.isFullscreen = ownsFullscreen(mapContainer);
        showExitFailHint(map, env);
      });
    return;
  }

  if (map.isFullscreen) {
    exitPseudo(map, fsBtn, container, env);
    return;
  }

  if (isEnabled()) {
    mapContainer
      .requestFullscreen()
      .then(() => {
        map.isFullscreen = true;
      })
      .catch(() => {
        // A policy rejection (permission lost mid-flight) must not dead-end:
        // recover state, then fall back to pseudo mode like an API-less browser.
        const active = ownsFullscreen(mapContainer);
        map.isFullscreen = active;
        // A rejection can arrive after the browser actually completed the
        // transition. Entering pseudo then would put both states on the
        // container at once, and the exit branch (native first) would never
        // clear the class — it would outlive the session and keep hijacking
        // every overlay's host. Reconcile the class and let fullscreenchange
        // own the UI in that case.
        setPseudoFullscreen(mapContainer, false);
        if (active) return;
        enterPseudo(map, fsBtn, container, env);
      });
    return;
  }
  enterPseudo(map, fsBtn, container, env);
};

// ══════════════════════════════════════════════════════════════════════════════
// buildFullscreenChangeHandler  —  the fullscreenchange handler the control
// binds on document through BaseControl.on, so removal rides the mounting's
// signal (no manual teardown, and no map.on('unload') needed: Leaflet already
// routes map.remove() → unload → control.remove() → onRemove → abort).
// ══════════════════════════════════════════════════════════════════════════════
const buildFullscreenChangeHandler =
  (map: L.Map, fsBtn: HTMLElement, container: HTMLElement, env: Env) => () => {
    const mapContainer = map.getContainer();
    const active = ownsFullscreen(mapContainer);
    // Native fullscreen outranks pseudo on the same container. A stale class
    // here would survive the native exit (that path clears native first) and
    // keep every overlay hosted in a container that is no longer a surface.
    if (active) setPseudoFullscreen(mapContainer, false);
    // A sibling map's native transition fires this handler too. It must not
    // clear a pseudo session that is still on this map's container.
    map.isFullscreen =
      active || mapContainer.classList.contains(CLASSES.PSEUDO_FULLSCREEN);
    updateUI(map, fsBtn, container, env);
  };

export { buildFullscreenChangeHandler, toggleFullscreen, updateUI };
