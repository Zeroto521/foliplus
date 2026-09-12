import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HINT_DURATION,
  HintManager,
  ensureHint,
  registerHintIcon,
} from "#core/hint.js";

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Stub map that records `on()` calls AND invokes them, so a test can fire
 *  `unload` and observe the teardown path. Leaflet's own `_on` silently
 *  no-ops when the handler is not a function, so a bare `vi.fn()` stub
 *  would swallow the registration and the teardown assertions would never
 *  exercise a real handler — recording and invoking here keeps that failure
 *  mode loud instead of invisible. */
type StubMap = {
  foliplus?: Record<string, unknown>;
  on: (type: string, fn: unknown) => void;
  handlers: Record<string, Array<() => void>>;
};

const makeMap = (): StubMap => {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    on: (type, fn) => {
      if (typeof fn !== "function") return; // mirror Leaflet's `_on` guard
      handlers[type] = [...(handlers[type] ?? []), fn];
    },
    handlers,
  };
};

/** Fire a recorded map event (`unload`, …) and return how many handlers ran. */
const fire = (map: StubMap, type: string): number => {
  const list = map.handlers[type] ?? [];
  list.forEach(fn => fn());
  return list.length;
};

/** Fire map `unload` and return a handle on the torn-down state: the
 *  (now inert) `map.foliplus` stubs and a silent `console.warn` spy. */
const unloadMap = (map: StubMap) => {
  fire(map, "unload");
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  return {
    showHint: map.foliplus?.showHint as (() => void) | undefined,
    hideHint: map.foliplus?.hideHint as (() => void) | undefined,
    warn,
  };
};

describe("HINT_DURATION", () => {
  it("has correct values", () => {
    expect(HINT_DURATION.SHORT).toBe(1200);
    expect(HINT_DURATION.MEDIUM).toBe(2500);
    expect(HINT_DURATION.LONG).toBe(4000);
    expect(HINT_DURATION.PERSIST).toBe(0);
  });
});

describe("HintManager", () => {
  it("showHint appends a hint element to the body", () => {
    const mgr = new HintManager();
    mgr.showHint("key", "hello", 0);
    const el = document.querySelector(".foliplus-hint");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("hello");
  });

  it("hideHint removes the hint element", () => {
    const mgr = new HintManager();
    mgr.showHint("key", "hello", 0);
    expect(document.querySelector(".foliplus-hint")).not.toBeNull();
    mgr.hideHint("key");
    expect(document.querySelector(".foliplus-hint")).toBeNull();
  });

  it("auto-dismisses after the duration elapses", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.showHint("key", "hello", 100);
    expect(document.querySelector(".foliplus-hint")).not.toBeNull();
    vi.advanceTimersByTime(101);
    expect(document.querySelector(".foliplus-hint")).toBeNull();
    vi.useRealTimers();
  });

  it("stacks multiple hints with increasing offsets", () => {
    const mgr = new HintManager();
    mgr.showHint("a", "one", 0);
    mgr.showHint("b", "two", 0);
    const els = document.querySelectorAll(".foliplus-hint");
    expect(els.length).toBe(2);
    expect(els[1].style.bottom).not.toBe(els[0].style.bottom);
  });

  it("registerHintIcon prepends an icon to the hint text", () => {
    registerHintIcon("with_icon", "<svg></svg>");
    const mgr = new HintManager();
    mgr.showHint("with_icon", "text", 0);
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
  });

  it("destroy removes all hints and clears timers", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.showHint("a", "one", 1000);
    mgr.showHint("b", "two", 1000);
    mgr.destroy();
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    vi.useRealTimers();
  });

  it("a destroyed manager cannot create new hints", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.showHint("key", "hello", 100);
    mgr.destroy();
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);

    // The manager is inert: a later call appends nothing and arms no timer.
    mgr.showHint("key", "again", 100);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    expect(mgr.hintMap.size).toBe(0);
    vi.advanceTimersByTime(200);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    vi.useRealTimers();
  });

  it("migrates hints to the fullscreen element on fullscreenchange", () => {
    const mgr = new HintManager();
    mgr.showHint("key", "hello", 0);
    const el = document.querySelector(".foliplus-hint")!;
    expect(el.parentElement).toBe(document.body);

    const container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => container,
    });
    document.dispatchEvent(new Event("fullscreenchange"));

    expect(el.parentElement).toBe(container);

    // Exit fullscreen → back to body
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(el.parentElement).toBe(document.body);

    mgr.destroy();
  });

  it("shows a hint inside the fullscreen element and anchors it with relative", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      position: "static",
    } as any);
    const mgr = new HintManager();
    const container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => container,
    });

    mgr.showHint("key", "hello", 0);

    expect(document.querySelector(".foliplus-hint")!.parentElement).toBe(container);
    expect(container.style.position).toBe("relative");

    mgr.destroy();
    vi.restoreAllMocks();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
  });

  it("hideHint with a subkey removes only that sub-hint", () => {
    const mgr = new HintManager();
    mgr.showHint("key", "one", 0, false, "sub");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);

    mgr.hideHint("key", "sub");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
  });
});

describe("ensureHint", () => {
  it("attaches showHint/hideHint to map.foliplus", () => {
    const map = makeMap();
    ensureHint(map);
    expect(typeof map.foliplus?.showHint).toBe("function");
    expect(typeof map.foliplus?.hideHint).toBe("function");
  });

  it("is idempotent — repeated calls return the same instance", () => {
    const map = makeMap();
    const a = ensureHint(map);
    const b = ensureHint(map);
    expect(b).toBe(a);
  });

  it("exposes registerHintIcon on map.foliplus", () => {
    const map = makeMap();
    ensureHint(map);
    expect(typeof map.foliplus?.registerHintIcon).toBe("function");
    map.foliplus!.registerHintIcon("via_map", "<svg></svg>");
    map.foliplus!.showHint("via_map", "text", 0);
    expect(document.querySelector(".foliplus-hint-icon")).not.toBeNull();
  });

  it("is per-map — separate maps get separate instances", () => {
    const mapA = makeMap();
    const mapB = makeMap();
    const a = ensureHint(mapA);
    const b = ensureHint(mapB);
    expect(a).not.toBe(b);
    a.showHint("key", "A", 0);
    b.showHint("key", "B", 0);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(2);
    a.hideHint("key");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);
    b.hideHint("key");
  });

  it("syncs icons registered AFTER an existing manager was created (regression)", () => {
    // A later control's createControlEnv registers its icon after ensureHint
    // already created the manager — the new icon must appear.
    const map = makeMap();
    ensureHint(map); // manager created BEFORE the icon is registered
    registerHintIcon("late_icon", "<svg></svg>");
    map.foliplus!.showHint("late_icon", "text", 0);
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("text");
  });

  it("syncs icons to a manager created before registration, via syncIcons", () => {
    const mgr = new HintManager();
    registerHintIcon("probe", "<svg></svg>");
    // syncIcons was called by registerHintIcon for active managers
    expect(mgr.hintIcons["probe"]).toBe("<svg></svg>");
  });

  it("shows the icon for EVERY component regardless of load order", () => {
    // Simulate the real page: another control created the per-map manager
    // first, then each control's createControlEnv registers its icon later.
    // Historically LocateControl / MeasureControl / ExportControl hints were
    // missing icons in this order (registerHintIcon only updated the module
    // registry, never re-seeding the already-created manager).
    const map = makeMap();
    ensureHint(map); // manager created BEFORE the components below register
    const components = [
      "ExportControl",
      "FullscreenControl",
      "HeatmapControl",
      "LayerControl",
      "LocateControl",
      "MeasureControl",
      "SearchControl",
    ];
    for (const name of components) {
      registerHintIcon(name, '<svg data-name="' + name + '"></svg>');
      // Clear any previously shown hint so only the current one exists.
      document.body.innerHTML = "";
      map.foliplus!.showHint(name, name + " msg", 0);
      const icon = document.querySelector(".foliplus-hint-icon");
      expect(icon, name + " hint should have an icon").not.toBeNull();
      expect(
        icon!.querySelector("svg")!.getAttribute("data-name"),
        name + " icon should match",
      ).toBe(name);
    }
  });
});

describe("map unload teardown", () => {
  it("destroys the manager on map unload, unbinding the fullscreenchange listener", () => {
    vi.useFakeTimers();
    const map = makeMap();
    const mgr = ensureHint(map);
    // migrateHints is called through a bound arrow, so spying the class
    // method is the only way to observe the document listener afterwards.
    const migrateSpy = vi.spyOn(mgr, "migrateHints" as any);
    mgr.showHint("persist", "still open", HINT_DURATION.PERSIST);
    // Grab the element this manager just created. A global selector would
    // also match stray nodes left behind by sibling tests.
    const el = mgr.hintMap.values().next().value.element;

    document.dispatchEvent(new Event("fullscreenchange"));
    expect(migrateSpy).toHaveBeenCalledTimes(1); // listener still bound
    expect(el.isConnected).toBe(true);

    expect(fire(map, "unload")).toBe(1);
    expect(mgr.hintMap.size).toBe(0);
    expect(el.isConnected).toBe(false);

    document.dispatchEvent(new Event("fullscreenchange"));
    expect(migrateSpy).toHaveBeenCalledTimes(1); // listener unbound

    // A second manager (another map on the page) proves teardown is scoped:
    // it still receives newly registered icons, and icon propagation does not
    // reach the destroyed manager.
    const other = new HintManager();
    other.showHint("persist", "other map", HINT_DURATION.PERSIST);
    registerHintIcon("late", "<svg></svg>");
    other.showHint("late", "late", HINT_DURATION.PERSIST);
    expect(other.hintMap.size).toBe(2);
    expect(mgr.hintMap.size).toBe(0); // dead manager untouched

    other.destroy();
    migrateSpy.mockRestore();
    vi.useRealTimers();
  });

  it("builds a fresh manager when the same map object is re-ensured after unload", () => {
    const map = makeMap();
    const first = ensureHint(map);
    expect(ensureHint(map)).toBe(first);

    fire(map, "unload");
    expect(first.destroyed).toBe(true);

    const second = ensureHint(map);
    expect(second).not.toBe(first);
    expect(second.destroyed).toBe(false);
    // The rebuilt manager is bound to the same map.foliplus object.
    expect(map.foliplus?.hintManager).toBe(second);
    second.showHint("key", "again", HINT_DURATION.PERSIST);
    expect(second.hintMap.size).toBe(1);
    second.destroy();
  });

  it("detaches the bound showHint closure so a call after unload warns without adding a node", () => {
    vi.useFakeTimers();
    const map = makeMap();
    const mgr = ensureHint(map);
    const { showHint, warn } = unloadMap(map);

    // The bound closure is replaced, not left wired to the dead manager.
    expect(map.foliplus?.hintManager).toBeUndefined();
    expect(showHint).toBeDefined();

    showHint!();
    showHint!();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[0]?.[0]).toContain("after the map unloaded");

    // No node resurrected, and no timer armed on the dead manager.
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    expect(mgr.hintMap.size).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);

    warn.mockRestore();
    vi.useRealTimers();
  });

  it("keeps hideHint after unload as a silent no-op", () => {
    const map = makeMap();
    const mgr = ensureHint(map);
    const { hideHint, warn } = unloadMap(map);

    hideHint!();
    expect(warn).not.toHaveBeenCalled();
    expect(mgr.hintMap.size).toBe(0);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    warn.mockRestore();
  });

  it("teardown is scoped per map — a sibling map keeps its manager", () => {
    const mapA = makeMap();
    const mapB = makeMap();
    const a = ensureHint(mapA);
    const b = ensureHint(mapB);
    a.showHint("key", "A", HINT_DURATION.PERSIST);
    b.showHint("key", "B", HINT_DURATION.PERSIST);

    unloadMap(mapA);

    // mapB is untouched: same manager, node still in the DOM, still active
    // enough to receive newly registered icons.
    expect(mapB.foliplus?.hintManager).toBe(b);
    expect(mapB.foliplus?.hintManager).not.toBe(a);
    expect(b.hintMap.size).toBe(1);
    registerHintIcon("sibling_icon", "<svg></svg>");
    expect(b.hintIcons["sibling_icon"]).toBe("<svg></svg>");
    // The dead manager no longer receives icons through activeManagers.
    expect(a.hintIcons["sibling_icon"]).toBeUndefined();
    expect(mapA.foliplus?.hintManager).toBeUndefined();

    b.destroy();
  });

  it("leaves foreign foliplus stubs alone when the handler's manager was replaced", () => {
    // Guard: if `map.foliplus.hintManager` is no longer the one the handler
    // captured, the teardown must not overwrite whatever closures replaced it.
    const map = makeMap();
    const mgr = ensureHint(map);
    fire(map, "unload");
    expect(mgr.hintMap.size).toBe(0);

    // Simulate a foreign owner installing its own stubs after the map unloaded.
    const foreignShow = () => {};
    const foreignHide = () => {};
    map.foliplus!.showHint = foreignShow;
    map.foliplus!.hideHint = foreignHide;

    // Re-fire the recorded teardown handler: it must leave the foreign stubs
    // untouched (they did not belong to this manager).
    fire(map, "unload");
    expect(map.foliplus?.showHint).toBe(foreignShow);
    expect(map.foliplus?.hideHint).toBe(foreignHide);
    expect(mgr.hintMap.size).toBe(0);
  });
});
