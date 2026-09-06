// core/hint — per-map toast system.
// Each map gets its own HintManager instance (via ensureHint), attached to
// `map.foliplus.showHint/hideHint`.  No global state leaks to `window.foliplus`.
import { dom } from "#common/dom.js";

const BASE = { BOTTOM: 20, STACK_GAP: 40, ZINDEX: 10000 };
const CLASS = "foliplus-hint";

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
 *  createControlEnv), so all live managers must be re-seeded. */
const registerHintIcon = (key: string, iconSvg: string) => {
  hintIconRegistry[key] = iconSvg;
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

    // When the map goes fullscreen, only the fullscreen element is visible —
    // hints appended to document.body would disappear. Migrate them to the
    // fullscreen element (and back again on exit). Standard API only — the
    // webkit prefix is dropped (see FullscreenControl/api.ts).
    this.onFullscreenChange = () => this.migrateHints();

    document.addEventListener("fullscreenchange", this.onFullscreenChange);

    activeManagers.add(this);
  }

  private migrateHints() {
    const target: HTMLElement =
      (document.fullscreenElement as HTMLElement | null) || document.body;
    if (target === document.documentElement) return;
    let moved = false;
    for (const entry of this.hintMap.values()) {
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
  ) {
    if (subkey) this.hideHint(key, subkey);
    else if (!append) this.hideHint(key);

    const hintTarget: HTMLElement =
      (document.fullscreenElement as HTMLElement | null) || document.body;

    const cls = subkey
      ? `${CLASS} ${CLASS}-${key}-${subkey}`
      : append
        ? `${CLASS} ${CLASS}-${key}-${Date.now()}`
        : `${CLASS} ${CLASS}-${key}`;

    const icon = (this.hintIcons && this.hintIcons[key]) || "";

    const el = dom.el("div", {
      class: `${cls} ${CLASS}`,
      parent: hintTarget,
      innerHTML: icon ? `<span class="foliplus-hint-icon">${icon}</span>${text}` : text,
    });

    anchorRelative(hintTarget);

    const storeKey = subkey
      ? `${key}|${subkey}`
      : append
        ? `${key}-${Date.now()}`
        : key;

    this.hintMap.set(storeKey, { element: el, timer: null });

    this.repositionHints();

    if (duration !== 0) {
      const entry = this.hintMap.get(storeKey);
      if (entry) {
        entry.timer = setTimeout(
          () => (subkey ? this.hideHint(key, subkey) : this.hideHint(storeKey)),
          duration || HINT_DURATION.MEDIUM,
        );
      }
    }
  }

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
        const entry = this.hintMap.get(k);
        if (entry) {
          if (entry.timer) clearTimeout(entry.timer);
          if (entry.element) entry.element.remove();

          this.hintMap.delete(k);
        }
      }
    }

    this.repositionHints();
  }

  private repositionHints() {
    let idx = 0;
    for (const v of this.hintMap.values()) {
      v.element.style.bottom = `${BASE.BOTTOM + idx * BASE.STACK_GAP}px`;

      v.element.style.zIndex = String(BASE.ZINDEX + idx);

      idx++;
    }
  }

  destroy() {
    for (const entry of this.hintMap.values()) {
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.element) entry.element.remove();
    }

    this.hintMap.clear();

    document.removeEventListener("fullscreenchange", this.onFullscreenChange);

    activeManagers.delete(this);
  }
}

/** Ensure `map.foliplus` has a per-map HintManager.  Idempotent. */
const ensureHint = (map: L.Map): HintManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  const mgr = new HintManager();

  instances.set(map, mgr);
  // Ensure map.foliplus exists so components can call map.foliplus!.showHint
  if (!map.foliplus) map.foliplus = { LayerAPI: null! } as unknown as MapFoliplus;

  map.foliplus!.showHint = mgr.showHint.bind(mgr);

  map.foliplus!.hideHint = mgr.hideHint.bind(mgr);

  map.foliplus!.registerHintIcon = (key: string, svg: string) => {
    registerHintIcon(key, svg); // syncs every active manager
  };
  return mgr;
};

export { ensureHint, HINT_DURATION, HintManager, registerHintIcon };
