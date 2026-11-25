// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONFIG / T are no longer module-level: defineControl hands them off to the
// control instance, and the entry passes an env slice into these functions.
import { isEnabled, ownsFullscreen } from "./api.js";
import { CLASSES, containerId } from "./const.js";
import * as SVGs from "./icon.js";
import { HINT_DURATION } from "#core/overlay/index.js";
import { setPseudoFullscreen } from "#platform/fullscreen.js";
import { PANEL_CLASS, SCALE_CLASS } from "#ui/index.js";

/** Per-call env slice the entry passes in. Same vocabulary as ControlEnv but
 *  narrowed to what this module reads — `name` and `hide_*` from CONFIG, plus
 *  the scoped translator. */
type Env = {
  config: ComponentConfig;
  T: (key: string) => string;
  /** The mounting's AbortSignal, when the caller is a mounted control. The
   *  native paths below resolve after the click that asked for them, so a
   *  rejection landing after removal must not re-enter pseudo mode. Optional
   *  because the functions are also reachable from tests. */
  signal?: AbortSignal;
};

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
      .querySelectorAll(`.leaflet-control, ${SCALE_CLASS.WRAP}`);
    const cid = containerId(config.name, config.position as string);
    for (const c of controls) {
      if (c.contains(container) || c.closest?.(`#${cid}`)) continue;
      c.classList.toggle(PANEL_CLASS.HIDDEN, isFull);
    }
  }

  if (config.hide_self) {
    // Zoom stays: the bar is the only zoom left in fullscreen (hide_others hides
    // Leaflet's own control), and hide_self is documented as the fullscreen
    // button itself — hiding the zoom with it left a fullscreen map unzoomable.
    const selfBtns = container.querySelectorAll(`.${CLASSES.TOGGLE}`);
    for (const btn of selfBtns) btn.classList.toggle(PANEL_CLASS.HIDDEN, isFull);
  }

  map.foliplus!.hint.set(
    config.name,
    "",
    hintText ?? (isFull ? T("enter") : T("exit")),
    { duration: HINT_DURATION.MEDIUM },
  );
};

const showExitFailHint = (map: L.Map, env: Env) => {
  map.foliplus!.hint.set(env.config.name, "", env.T("exit_fail"), {
    duration: HINT_DURATION.MEDIUM,
  });
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

/** Release a pseudo session the mounting left behind.
 *  Conditional on the class actually being there: a native session on the same
 *  container must not have its flag cleared by a control going away, and the
 *  toggle (the only user gesture that ends pseudo mode) may already be gone.
 *  No hint is shown — the control is being removed, and announcing "exit"
 *  fullscreen for it would be noise nobody asked for. */
const releasePseudo = (map: L.Map) => {
  const mapContainer = map.getContainer();
  if (!mapContainer.classList.contains(CLASSES.PSEUDO_FULLSCREEN)) return;
  setPseudoFullscreen(mapContainer, false);
  map.invalidateSize();
  map.isFullscreen = false;
};

/** Maps whose native fullscreen session this control is part of. The native
 *  exit branch clears map.isFullscreen before the fullscreenchange event lands,
 *  so the handler cannot tell "our session ended" from "somebody else's map
 *  transitioned" by reading the map alone. Keyed per map: one bundle serves
 *  every map on the page. */
const nativeSessions = new WeakSet<L.Map>();

/** Forget a map's native fullscreen session on control teardown. The exit
 *  handler clears nativeSessions when the fullscreenchange event lands, but a
 *  control removed before that event leaves a stale entry: the re-added
 *  control's fresh handler would then misjudge a sibling's transition as this
 *  map's own exit. Deleting an absent key is a no-op, so calling this on every
 *  teardown is safe. */
const releaseNativeSession = (map: L.Map) => {
  nativeSessions.delete(map);
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
    // The .then below clears map.isFullscreen before the event lands; record
    // the session now so the handler still recognises the exit as this map's.
    nativeSessions.add(map);
    document
      .exitFullscreen()
      .then(() => {
        map.isFullscreen = false;
        // A native transition always wins over a pseudo class: a request that
        // rejected but completed natively, or a permission flip mid-session,
        // can leave both states on the container. Clear pseudo here so
        // fullscreenSurface() stops treating the container as a surface after
        // the native session ends.
        // liveness-exempt: the native exit already completed, so clearing the
        // pseudo class can only release residue — it cannot enter pseudo mode,
        // and mapContainer was captured before this continuation started.
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
        nativeSessions.add(map);
      })
      .catch(() => {
        // A removed mounting must not fall back: the recovery below ends in
        // enterPseudo, which re-enters pseudo mode with the toggle already gone
        // — the class would survive the session and hijack every overlay's host
        // for the page's life. The signal is aborted in onRemove, so this is
        // the same check as the removed flag.
        if (env.signal?.aborted) return;
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
    const pseudo = mapContainer.classList.contains(CLASSES.PSEUDO_FULLSCREEN);
    const native = nativeSessions.has(map);
    // fullscreenchange is document-global: a sibling map's transition reaches
    // this handler too. Guarding only the assignment below left the side effects
    // unguarded — a map that was never fullscreen unhid every control
    // (hide_others) and announced an exit it never entered. Scope first, then
    // let the relevant path own both the state and the repaint.
    //   active — this container owns the native session;
    //   pseudo — a pseudo session is live here;
    //   map.isFullscreen — this map believes it is fullscreen, which is how the
    //     end of its own native session is recognised (the element is gone by
    //     then, so neither active nor pseudo holds);
    //   native — the exit branch already cleared map.isFullscreen, so the
    //     session record is the only remaining evidence that this map is the
    //     one that just left fullscreen.
    if (!active && !pseudo && !map.isFullscreen && !native) return;
    if (!active) nativeSessions.delete(map);
    // Native fullscreen outranks pseudo on the same container. A stale class
    // here would survive the native exit (that path clears native first) and
    // keep every overlay hosted in a container that is no longer a surface.
    if (active) setPseudoFullscreen(mapContainer, false);
    map.isFullscreen = active || pseudo;
    updateUI(map, fsBtn, container, env);
  };

export {
  buildFullscreenChangeHandler,
  releaseNativeSession,
  releasePseudo,
  toggleFullscreen,
  updateUI,
};
