// core/overlay/hint — per-map toast system.
// Each map gets its own HintManager instance (via ensureHint), attached to
// `map.foliplus.showHint/hideHint`.  No global state leaks to `window.foliplus`.
import { parseSVG } from "../sanitize.js";
import { HINT_CLASS } from "./hintClassName.js";
import { ensureMapFoliplus } from "#core/mapApi.js";
import { cssVar } from "#platform/cssvar.js";
import { dom } from "#platform/dom.js";
import { type FinalizeStep, finalize } from "#platform/finalize.js";
import { fullscreenSurface, onFullscreenSurfaceChange } from "#platform/fullscreen.js";
import { ICON_LOADING } from "#platform/icon.js";
import { createLogger } from "#platform/log.js";

const log = createLogger("Hint");

const BASE = { BOTTOM: 20, STACK_GAP: 40 };
const CLASS = HINT_CLASS.SHELL;
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
  /** The text the entry currently paints. This — together with `icon` — is the
   *  dedupe source: a caller that pushes its state every apply re-sends the
   *  same pair and must not rebuild the DOM or restart the timer. */
  text: string;
  /** The icon markup the entry currently paints ("" = no icon). */
  icon: string;
}

/** Icon choice for {@link HintManager.set}. Omitted = the key's registered
 *  icon; `"loading"` = the built-in spinner; another string = that registry
 *  key's icon; `null` = no icon. */
type HintIcon = "loading" | string | null;

interface HintOptions {
  /** Auto-dismiss delay in ms (see HINT_DURATION); 0 keeps the hint until it is
   *  cleared. Defaults to HINT_DURATION.MEDIUM. */
  duration?: number;
  /** Icon override; see {@link HintIcon}. */
  icon?: HintIcon;
}

/** The per-map public hint API, attached as `map.foliplus.hint`.
 *
 *  Two members, one registry: `set`/clear` address a (key, slot) pair in the
 *  manager's own `hintMap` — there is no second store to keep in sync, and a
 *  caller that re-applies its state every frame is a no-op instead of a DOM
 *  rebuild (see {@link HintManager.set}). */
interface HintAPI {
  /** Set the hint in one slot; identical text + icon is a no-op. */
  set: (key: string, slot: string, text: string, opts?: HintOptions) => void;
  /** Clear one slot, or every slot of the key when `slot` is omitted. */
  clear: (key: string, slot?: string) => void;
  /** Register an SVG icon for a hint key (sanitised; propagates to live maps). */
  registerIcon: (key: string, iconSvg: string) => void;
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
  /** The map container this manager belongs to — scopes surface resolution so
   *  hints never land in a sibling map's pseudo container. Null when the
   *  manager is constructed directly (tests, page-level use). */
  private readonly surfaceScope: HTMLElement | null;
  private readonly detachSurface: () => void;

  constructor(surfaceScope: HTMLElement | null = null) {
    this.hintIcons = { ...hintIconRegistry };
    this.hintMap = new Map();
    this.surfaceScope = surfaceScope;
    // When a covering surface activates (native fullscreen or pseudo-fullscreen,
    // see platform/fullscreen.ts), only that surface's subtree is visible — hints
    // appended to document.body would be buried under the opaque map. Move
    // them onto the surface (and back again on exit). Pseudo mode changes a
    // class and fires no DOM event, so this subscribes to the shared surface
    // announcement rather than the native event: a hint that already exists
    // when fullscreen starts must re-seat immediately, not wait for the next
    // showHint. Standard API only — the webkit prefix is dropped (see
    // FullscreenControl/api.ts).
    this.detachSurface = onFullscreenSurfaceChange(() => this.reattachHints());
    activeManagers.add(this);
  }

  /** Resolve the host for this manager's overlays. Scoped to the map
   *  container when one was supplied. */
  private surface(): HTMLElement {
    return fullscreenSurface(this.surfaceScope);
  }

  private reattachHints() {
    const target = this.surface();
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

  /** Resolve the icon markup for a `set` call.
   *
   *  The icon is the only HTML in a hint (`registerHintIcon` sanitises at
   *  entry); the text stays a TextNode, so a rogue locale value cannot turn a
   *  hint into markup. */
  private iconMarkup(key: string, icon?: HintIcon): string {
    if (icon === "loading") return ICON_LOADING;
    if (icon === null) return "";
    return this.hintIcons?.[icon ?? key] ?? "";
  }

  /** Set the hint in one slot — the single public write entry.
   *
   *  A slot is the unit of identity under a key: two surfaces of one component
   *  use two slots and never clobber each other, and the same slot pushed with
   *  the same text + icon is a true no-op (no DOM rebuild, no timer restart).
   *  A changed text/icon rebuilds the entry in place, so the stack order of the
   *  other hints is preserved.
   *
   *  @param key - Owning component name (also selects its registered icon).
   *  @param slot - Slot within the key; `""` is the key's default slot.
   *  @param text - Hint text (a TextNode, never markup).
   *  @param opts.duration - Auto-dismiss delay; 0 persists until cleared.
   *  @param opts.icon - Icon override; see {@link HintIcon}.
   */
  set(key: string, slot: string, text: string, opts: HintOptions = {}) {
    const { duration = HINT_DURATION.MEDIUM, icon } = opts;
    const storeKey = slot ? `${key}|${slot}` : key;
    const iconMarkup = this.iconMarkup(key, icon);
    const previous = this.hintMap.get(storeKey);
    if (previous?.text === text && previous.icon === iconMarkup) {
      // Identical push: the caller is re-applying its state, not changing it.
      // Dom and timer stay exactly as they are.
      return;
    }

    // Re-seat live hints first: a PERSIST hint shown inside a surface that has
    // since exited (pseudo-fullscreen toggled off) would otherwise stay
    // stranded in the map container.
    this.reattachHints();
    const hintTarget = this.surface();
    // `{ html }` must be a CHILD, not an attr — `dom.el` sets an attr for any
    // unrecognised key.
    const el = dom.el(
      "div",
      {
        class: slot ? `${CLASS} ${CLASS}-${key}-${slot}` : `${CLASS} ${CLASS}-${key}`,
        parent: hintTarget,
      },
      ...(iconMarkup
        ? [dom.el("span", { class: HINT_CLASS.ICON }, { html: iconMarkup })]
        : []),
      text,
    );
    if (previous) {
      if (previous.timer) clearTimeout(previous.timer);
      // Replace in place so a re-rendered slot keeps its stack position.
      if (previous.element.parentElement) previous.element.replaceWith(el);
    }
    anchorRelative(hintTarget);
    this.hintMap.set(storeKey, { element: el, timer: null, text, icon: iconMarkup });
    this.repositionHints();

    if (duration !== 0) {
      const entry = this.hintMap.get(storeKey)!;
      entry.timer = setTimeout(() => this.clear(key, slot), duration);
    }
  }

  /** Drop the hint in one slot, or every slot of a key when `slot` is omitted.
   *  Removes the node and its pending timer, then re-stacks what is left. */
  clear(key: string, slot?: string) {
    if (slot) {
      this.dropEntry(`${key}|${slot}`);
      this.repositionHints();
      return;
    }
    for (const storeKey of [...this.hintMap.keys()]) {
      if (storeKey === key || storeKey.startsWith(`${key}|`)) {
        this.dropEntry(storeKey);
      }
    }
    this.repositionHints();
  }

  /** Drop one entry by its store key. Guards a malformed entry (no element or
   *  timer) so external mutation cannot make teardown throw. */
  private dropEntry(storeKey: string) {
    const entry = this.hintMap.get(storeKey);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.element) entry.element.remove();
    this.hintMap.delete(storeKey);
  }

  private repositionHints() {
    let idx = 0;
    for (const v of this.hintMap.values()) {
      v.element.style.bottom = `${BASE.BOTTOM + idx * BASE.STACK_GAP}px`; // placement-adapter: hint stack, not an anchored popup
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
          "detach-surface",
          () => {
            this.detachSurface();
          },
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
  map.foliplus!.hint = {
    set: () => log.warn("hint.set called after the map unloaded"),
    /* eslint-disable-next-line @typescript-eslint/no-empty-function -- post-unload: clear/register are harmless, set warns */
    clear: () => {},
    /* eslint-disable-next-line @typescript-eslint/no-empty-function -- post-unload: clear/register are harmless, set warns */
    registerIcon: () => {},
  };
};

/** Ensure `map.foliplus` has a per-map HintManager.  Idempotent. */
const ensureHint = (map: L.Map): HintManager => {
  const existing = instances.get(map);
  if (existing) return existing;
  // Scope surface resolution to this map's container. A manager built without
  // a map (tests, standalone use) keeps the document-wide resolver.
  const mgr = new HintManager(
    typeof map.getContainer === "function" ? map.getContainer() : null,
  );
  instances.set(map, mgr);
  const api = ensureMapFoliplus(map);
  api.hint = {
    set: mgr.set.bind(mgr),
    clear: mgr.clear.bind(mgr),
    registerIcon: (key: string, svg: string) => {
      registerHintIcon(key, svg); // syncs every active manager
    },
  };
  // On map unload, tear down hints and drop the surface subscription. Without
  // this the manager outlives its map: the WeakMap entry frees the instance,
  // but document.body hints, the open setTimeout timers, and the surface
  // subscription all leak. Mirrors the per-map cleanup pattern used by
  // core/mode and core/interaction.
  map.on("unload", () => destroyManager(map, mgr));
  return mgr;
};

export { ensureHint, HINT_DURATION, HintManager, registerHintIcon };
export type { HintAPI, HintIcon, HintOptions };
