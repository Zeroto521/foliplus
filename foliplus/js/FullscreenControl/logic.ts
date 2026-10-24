// FullscreenControl core logic — toggleFullscreen, updateUI, event handling.
// CONFIG / T are no longer module-level: defineControl hands them off to the
// control instance, and the entry passes an env slice into these functions.
import { HINT_DURATION } from "#core/hint.js";
import { getFullscreenEl, isEnabled } from "./api.js";
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
  const isFull = Boolean(getFullscreenEl()) || map.isFullscreen;
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
  map.getContainer().classList.add(CLASSES.PSEUDO_FULLSCREEN);
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
  map.getContainer().classList.remove(CLASSES.PSEUDO_FULLSCREEN);
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
  if (getFullscreenEl()) {
    document
      .exitFullscreen()
      .then(() => {
        map.isFullscreen = false;
      })
      .catch(() => {
        map.isFullscreen = Boolean(getFullscreenEl());
        showExitFailHint(map, env);
      });
    return;
  }

  if (map.isFullscreen) {
    exitPseudo(map, fsBtn, container, env);
    return;
  }

  if (isEnabled()) {
    map
      .getContainer()
      .requestFullscreen()
      .then(() => {
        map.isFullscreen = true;
      })
      .catch(() => {
        // A policy rejection (permission lost mid-flight) must not dead-end:
        // recover state, then fall back to pseudo mode like an API-less browser.
        map.isFullscreen = Boolean(getFullscreenEl());
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
    map.isFullscreen = Boolean(getFullscreenEl());
    updateUI(map, fsBtn, container, env);
  };

export { buildFullscreenChangeHandler, toggleFullscreen, updateUI };
