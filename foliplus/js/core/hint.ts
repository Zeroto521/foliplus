// core/hint — per-map toast system.
// Each map gets its own HintManager instance (via ensureHint), attached to
// `map.foliplus.showHint/hideHint`.  No global state leaks to `window.foliplus`.
import { fullscreenSurface } from "#core/fullscreen.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { cssVar } from "#common/cssvar.js";
import { dom } from "#common/dom.js";
import { type FinalizeStep, finalize } from "#common/finalize.js";
import { ICON_LOADING } from "#common/icon.js";
import { createLogger } from "#common/log.js";
import { parseSVG } from "#common/sanitize.js";

const log = createLogger("Hint");

const BASE = { BOTTOM: 20, STACK_GAP: 40 };
const CLASS = "foliplus-hint";
const DEFAULT_HINT_Z_INDEX = 10000;

/** Hint z-index base, read once from the --foliplus-z-index-hint token (fallback 10000). */
let hintZIndex: number | null = null;
const zIndexBase = (): number => {
  hintZIndex ??=
    Number(
      cssVar(
        document.documentElement,
        "--foliplus-z-index-hint",
        String(DEFAULT_HINT_Z_INDEX),
      ),
    ) || DEFAULT_HINT_Z_INDEX;
  return hintZIndex;
};

/** Make a non-body target a positioned ancestor so absolutely-positioned hints
 *  anchor to it (the default body/fullscreen root is already positioned). */
const anchorRelative = (target: HTMLElement): void => {
  if (target === document.body || target === document.documentElement) return;
  const cs = window.getComputedStyle(target);
  if (cs.position === "static") target.style.position = "relative";
};

/** Hint duration constants (shared by components and the toast system). */
const HINT_DURATION = { SHORT: 1200, MEDIUM: 2500, LONG: 4000, PERSIST: 0 };

interface HintEntry {
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
}

// Module-level icon registry seeded by createControlEnv; every HintManager
// instance copies it so icons registered at load time are available per-map.
const hintIconRegistry: Record<string, string> = {};

/** Register an SVG icon for a hint type and sync it into every active manager.
 *  Icons may be registered AFTER a manager was created (a later control's
 *  createControlEnv), so all live managers must be re-seeded.
 *
 *  This is a public runtime API — a plugin author can reach it through
 *  `map.foliplus.registerHintIcon()`, and the value lands in an innerHTML
 *  sink on every hint that carries this key. Clean it on the way in so no
 *  caller can bypass the allowlist. */
const registerHintIcon = (key: string, iconSvg: string) => {
  hintIconRegistry[key] = parseSVG(iconSvg);
  for (const mgr of activeManagers) mgr.syncIcons();
};

// Per-map instance storage (WeakMap so destroyed maps are GC'd).
const instances = new WeakMap<L.Map, HintManager>();

// All live managers — iterated by registerHintIcon to propagate new icons.
const activeManagers = new Set<HintManager>();

class HintManager {
  hintIcons: Record<string, string>;
  hintMap: Map<string, HintEntry>;
  private onFullscreenChange: () => void;

  constructor() {
    this.hintIcons = { ...hintIconRegistry };
    this.hintMap = new Map();
    // When a covering surface activates (native fullscreen or pseudo-fullscreen,
    // see core/fullscreen.ts), only that surface's subtree is visible — hints
    // appended to document.body would be buried under the opaque map. Move
    // them onto the surface (and back again on exit). Standard API only — the
    // webkit prefix is dropped (see FullscreenControl/api.ts).
    this.onFullscreenChange = () => this.reattachHints();
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
    activeManagers.add(this);
  }

  private reattachHints() {
    const target = fullscreenSurface();
    let moved = false;
    for (const entry of this.hintMap.values()) {
      // Disconnected elements are stale (removed externally), not stranded on
      // an exited surface — re-attaching those would resurrect dead hints.
      if (!entry.element?.isConnected) continue;
      if (entry.element.parentElement !== target) {
        target.appendChild(entry.element);
        moved = true;
      }
    }
    if (moved) anchorRelative(target);
  }

  /** (Re)seed icons from the shared registry (called at registerHintIcon time). */
  syncIcons() {
    Object.assign(this.hintIcons, hintIconRegistry);
  }

  showHint(
    key: string,
    text: string,
    duration: number,
    append?: boolean,
    subkey?: string,
    withLoadingIcon = false,
  ) {
    if (subkey) this.hideHint(key, subkey);
    else if (!append) this.hideHint(key);

    // Re-seat live hints first: a PERSIST hint shown inside a surface that
    // has since exited (pseudo-fullscreen toggled off) would otherwise stay
    // stranded in the map container. The new hint then appends to the same
    // target reattachHints resolved.
    this.reattachHints();
    const hintTarget = fullscreenSurface();

    const cls = subkey
      ? `${CLASS} ${CLASS}-${key}-${subkey}`
      : append
        ? `${CLASS} ${CLASS}-${key}-${Date.now()}`
        : `${CLASS} ${CLASS}-${key}`;

    // The spinner is a hint shape, not a registered icon: withLoadingIcon
    // swaps in the built-in loader (a trusted repo constant) in place of the
    // control's registered icon. The icon — whichever it is — is the only HTML
    // in a hint (`registerHintIcon` sanitises at entry); the text stays a
    // TextNode, so a rogue locale value cannot turn a hint into markup.
    // `{ html }` must be a CHILD, not an attr — `dom.el` sets an attr for any
    // unrecognised key.
    const icon = withLoadingIcon ? ICON_LOADING : (this.hintIcons?.[key] ?? "");
    const el = dom.el(
      "div",
      { class: `${cls} ${CLASS}`, parent: hintTarget },
      ...(icon
        ? [dom.el("span", { class: "foliplus-hint-icon" }, { html: icon })]
        : []),
      text,
    );
    anchorRelative(hintTarget);
    const storeKey = subkey
      ? `${key}|${subkey}`
      : append
        ? `${key}-${Date.now()}`
        : key;
    this.hintMap.set(storeKey, { element: el, timer: null });

    this.repositionHints();

    if (duration !== 0) {
      const entry = this.hintMap.get(storeKey)!;
      entry.timer = setTimeout(
        () => (subkey ? this.hideHint(key, subkey) : this.hideHint(storeKey)),
        duration || HINT_DURATION.MEDIUM,
      );
    }
  }

  /** Clear a hint: drop its element and pending timer (not just hide).
   *  Without a subkey, every variant under `key` is dropped. */
  hideHint(key: string, subkey?: string) {
    if (subkey) {
      const storeKey = `${key}|${subkey}`;
      const entry = this.hintMap.get(storeKey);
      if (entry) {
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element) entry.element.remove();
        this.hintMap.delete(storeKey);
      }
      this.repositionHints();
      return;
    }
    for (const k of this.hintMap.keys()) {
      if (k === key || k.startsWith(`${key}-`) || k.startsWith(`${key}|`)) {
        const entry = this.hintMap.get(k)!;
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.element) entry.element.remove();
        this.hintMap.delete(k);
      }
    }
    this.repositionHints();
  }

  private repositionHints() {
    let idx = 0;
    for (const v of this.hintMap.values()) {
      v.element.style.bottom = `${BASE.BOTTOM + idx * BASE.STACK_GAP}px`;
      v.element.style.zIndex = String(zIndexBase() + idx);
      idx++;
    }
  }

  destroy() {
    // One named step per hint, so a single unremovable node cannot strand the
    // listener below or leave this manager in the module-level active set.
    const steps: FinalizeStep[] = [...this.hintMap].map(
      ([key, entry]): FinalizeStep => [
        `hint:${key}`,
        () => {
          if (entry.timer) clearTimeout(entry.timer);
          if (entry.element) entry.element.remove();
        },
      ],
    );
    finalize(
      [
        ...steps,
        [
          "detach-fullscreen",
          () =>
            document.removeEventListener("fullscreenchange", this.onFullscreenChange),
        ],
        [
          "deregister",
          () => {
            activeManagers.delete(this);
          },
        ],
      ],
      failure => log.warn(`destroy step "${failure.name}" threw`, failure.error),
    );
    this.hintMap.clear();
  }
}

/** Per-map teardown hook, called from the `unload` handler in `ensureHint`.
 *  Clears the `instances` WeakMap entry so `ensureHint` for the same map object
 *  rebuilds a fresh manager, and detaches the bound `showHint`/`hideHint`
 *  closures on `map.foliplus` — `destroy()` alone would leave them wired to a
 *  manager whose nodes and timers are already gone, so a call after unload would
 *  append nodes to `document.body` forever. Every call site reaches hints through
 *  `map.foliplus`, so replacing the closures here covers all of them. */
const destroyManager = (map: L.Map, mgr: HintManager): void => {
  mgr.destroy();
  instances.delete(map);
  map.foliplus!.showHint = () => log.warn("showHint called after the map unloaded");
  /* eslint-disable @typescript-eslint/no-empty-function -- post-unload: hide/register are harmless, showHint warns */
  map.foliplus!.hideHint = () => {};
  map.foliplus!.registerHintIcon = () => {};
  /* eslint-enable @typescript-eslint/no-empty-function */
};

/** Ensure `map.foliplus` has a per-map HintManager.  Idempotent. */
const ensureHint = (map: L.Map): HintManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const mgr = new HintManager();
  instances.set(map, mgr);
  const api = ensureMapFoliplus(map);
  api.showHint = mgr.showHint.bind(mgr);
  api.hideHint = mgr.hideHint.bind(mgr);
  api.registerHintIcon = (key: string, svg: string) => {
    registerHintIcon(key, svg); // syncs every active manager
  };
  // On map unload, tear down hints and unbind the document-level
  // fullscreenchange listener. Without this the manager outlives its map: the
  // WeakMap entry frees the instance, but document.body hints, the open
  // setTimeout timers, and the document listener all leak. Mirrors the per-map
  // cleanup pattern used by core/mode and core/interaction.
  map.on("unload", () => destroyManager(map, mgr));
  return mgr;
};

export { ensureHint, HINT_DURATION, HintManager, registerHintIcon };
