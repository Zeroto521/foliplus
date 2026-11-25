import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HINT_DURATION,
  type HintAPI,
  HintManager,
  ensureHint,
  registerHintIcon,
} from "#core/overlay/index.js";
import { setPseudoFullscreen } from "#platform/fullscreen.js";

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
  foliplus?: { hint: HintAPI };
  on: (type: string, fn: unknown) => void;
  handlers: Record<string, Array<() => void>>;
};

const makeMap = (): StubMap => {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    on: (type, fn) => {
      if (typeof fn !== "function") return; // mirror Leaflet's `_on` guard
      handlers[type] = [...(handlers[type] ?? []), fn as () => void];
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
  return { hint: map.foliplus!.hint!, warn };
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
  it("hint.set appends a hint element to the body", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
    const el = document.querySelector(".foliplus-hint");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("hello");
  });

  it("hint.clear removes the hint element", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
    expect(document.querySelector(".foliplus-hint")).not.toBeNull();
    mgr.clear("key");
    expect(document.querySelector(".foliplus-hint")).toBeNull();
  });

  it("hint.clear(key) clears every slot for that key", () => {
    const mgr = new HintManager();
    mgr.set("key", "append", "one", { duration: 0 }); // append
    expect(document.querySelector(".foliplus-hint")).not.toBeNull();
    mgr.clear("key");
    expect(document.querySelector(".foliplus-hint")).toBeNull();
  });

  it("withLoadingIcon renders the built-in spinner instead of the registered icon", () => {
    registerHintIcon(
      "key",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    const mgr = new HintManager();
    mgr.set("key", "", "text", { duration: 0, icon: "loading" });
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
    const svg = icon!.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg!.classList.contains("foliplus-spin")).toBe(true);
  });

  it("renders the registered icon by default, not the spinner", () => {
    registerHintIcon(
      "key",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    const mgr = new HintManager();
    mgr.set("key", "", "text", { duration: 0 });
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
    expect(icon!.querySelector("svg")!.classList.contains("foliplus-spin")).toBe(false);
  });

  it("auto-dismisses after the duration elapses", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 100 });
    expect(document.querySelector(".foliplus-hint")).not.toBeNull();
    vi.advanceTimersByTime(101);
    expect(document.querySelector(".foliplus-hint")).toBeNull();
    vi.useRealTimers();
  });

  it("stacks multiple hints with increasing offsets", () => {
    const mgr = new HintManager();
    mgr.set("a", "", "one", { duration: 0 });
    mgr.set("b", "", "two", { duration: 0 });
    const els = document.querySelectorAll<HTMLElement>(".foliplus-hint");
    expect(els.length).toBe(2);
    expect(els[1].style.bottom).not.toBe(els[0].style.bottom);
  });

  it("registerHintIcon prepends an icon to the hint text", () => {
    registerHintIcon(
      "with_icon",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    const mgr = new HintManager();
    mgr.set("with_icon", "", "text", { duration: 0 });
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
  });

  it("destroy removes all hints and clears timers", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("a", "", "one", { duration: 1000 });
    mgr.set("b", "", "two", { duration: 1000 });
    mgr.destroy();
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    vi.useRealTimers();
  });

  it("destroy is defensive against entries missing a timer or element", () => {
    // The guards on entry.timer and entry.element must not throw when an entry
    // is stored without either — a defensive fallback if the map is mutated
    // externally, not a runtime crash.
    const mgr = new HintManager();
    mgr.hintMap.set("ghost", { element: undefined, timer: null } as any);
    expect(() => mgr.destroy()).not.toThrow();
    expect(mgr.hintMap.size).toBe(0);
  });

  it("destroy keeps detaching after a node that refuses to be removed", () => {
    const mgr = new HintManager();
    mgr.set("a", "", "one", { duration: 0 });
    mgr.set("b", "", "two", { duration: 0 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const reattach = vi.spyOn(mgr, "reattachHints" as any);
    const stuck = mgr.hintMap.get("a")!.element;
    const healthy = mgr.hintMap.get("b")!.element;
    stuck.remove = () => {
      throw new Error("node stuck");
    };

    expect(() => mgr.destroy()).not.toThrow();

    // The failure is named, the other hint still goes, and the surface
    // subscription and the module-level registration are released regardless.
    expect(warn).toHaveBeenCalledWith(
      '[Hint] destroy step "hint:a" threw',
      expect.any(Error),
    );
    // The stuck node is the one failure left standing; everything else in the
    // teardown still ran.
    expect(stuck.isConnected).toBe(true);
    expect(healthy.isConnected).toBe(false);
    expect(mgr.hintMap.size).toBe(0);
    document.dispatchEvent(new Event("fullscreenchange"));
    expect(reattach).not.toHaveBeenCalled();
    const sync = vi.spyOn(mgr, "syncIcons");
    registerHintIcon("after_destroy", '<svg viewBox="0 0 8 8"></svg>');
    expect(sync).not.toHaveBeenCalled();
  });

  it("migrates hints to the fullscreen element on fullscreenchange", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
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

  it("does not migrate hints when fullscreenElement is documentElement", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
    const el = document.querySelector(".foliplus-hint")!;
    expect(el.parentElement).toBe(document.body);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => document.documentElement,
    });
    document.dispatchEvent(new Event("fullscreenchange"));

    // documentElement is the guard — hints stay in body
    expect(el.parentElement).toBe(document.body);

    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
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

    mgr.set("key", "", "hello", { duration: 0 });

    expect(document.querySelector(".foliplus-hint")!.parentElement).toBe(container);
    expect(container.style.position).toBe("relative");

    mgr.destroy();
    vi.restoreAllMocks();
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => null,
    });
  });

  it("shows a hint inside the pseudo-fullscreen container (embed burial fix)", () => {
    // Pseudo-fullscreen covers the viewport with the opaque map at the
    // fullscreen z-index — a body-appended toast would be painted under it
    // (the Feishu-embed report). The hint must live inside the container.
    const mgr = new HintManager();
    const container = document.createElement("div");
    container.className = "leaflet-container leaflet-pseudo-fullscreen";
    document.body.appendChild(container);

    mgr.set("key", "", "hello", { duration: 0 });

    const el = document.querySelector(".foliplus-hint")!;
    expect(el.parentElement).toBe(container);
    // Non-body targets become positioned ancestors so the absolute hint
    // anchors to them (same contract as the native fullscreen element).
    expect(container.style.position).toBe("relative");

    // Stranded re-seat: a PERSIST hint shown during pseudo mode must land
    // back on body once the surface is gone and the next hint fires.
    container.classList.remove("leaflet-pseudo-fullscreen");
    mgr.set("key2", "", "second", { duration: 0 });
    expect(el.parentElement).toBe(document.body);
    expect(document.querySelector(".foliplus-hint")!.parentElement).toBe(document.body);

    mgr.destroy();
  });

  it("re-seats an existing hint when pseudo-fullscreen activates", () => {
    // The hint exists BEFORE the surface appears. Pseudo mode fires no DOM
    // event, so only the surface announcement can rescue it — the original
    // embed bug ("click fullscreen, the visible toast vanishes under the
    // map") is exactly this order.
    const mgr = new HintManager();
    const container = document.createElement("div");
    container.className = "leaflet-container";
    document.body.appendChild(container);

    mgr.set("persist", "", "already open", { duration: HINT_DURATION.PERSIST });
    const el = document.querySelector(".foliplus-hint")!;
    expect(el.parentElement).toBe(document.body);

    setPseudoFullscreen(container, true);
    expect(el.parentElement).toBe(container);

    setPseudoFullscreen(container, false);
    expect(el.parentElement).toBe(document.body);

    mgr.destroy();
  });

  it("scopes pseudo re-seating to the manager's own map", () => {
    const mapA = document.createElement("div");
    mapA.className = "leaflet-container";
    const mapB = document.createElement("div");
    mapB.className = "leaflet-container";
    document.body.append(mapA, mapB);

    const mgr = new HintManager(mapB);
    mgr.set("persist", "", "map B", { duration: HINT_DURATION.PERSIST });
    const el = document.querySelector(".foliplus-hint")!;
    expect(el.parentElement).toBe(document.body);

    // A sibling map going fullscreen must not pull map B's toast into it.
    setPseudoFullscreen(mapA, true);
    expect(el.parentElement).toBe(document.body);

    setPseudoFullscreen(mapB, true);
    expect(el.parentElement).toBe(mapB);

    setPseudoFullscreen(mapB, false);
    expect(el.parentElement).toBe(document.body);

    mgr.destroy();
  });

  it("hint.clear(key, slot) removes only that slot", () => {
    const mgr = new HintManager();
    mgr.set("key", "sub", "one", { duration: 0 });
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);

    mgr.clear("key", "sub");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
  });

  it("hint.clear(key, slot) clears the timer", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("key", "sub", "one", { duration: 100 });
    const els = document.querySelectorAll(".foliplus-hint");
    expect(els.length).toBe(1);

    mgr.clear("key", "sub");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);

    vi.advanceTimersByTime(1000);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    vi.useRealTimers();
  });

  it("auto-dismisses a hint with duration and no subkey", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 100 });
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);

    vi.advanceTimersByTime(101);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    vi.useRealTimers();
  });

  it("hint.clear is defensive against entries missing a timer or element", () => {
    // Same guards as destroy — a malformed entry must not throw.
    const mgr = new HintManager();
    mgr.hintMap.set("ghost", { element: undefined, timer: null } as any);
    expect(() => mgr.clear("ghost")).not.toThrow();
    expect(mgr.hintMap.has("ghost")).toBe(false);
  });

  it("hint.clear(key, slot) is defensive against entries missing an element", () => {
    // The subkey branch has its own element guard — a malformed entry with no
    // element must not throw when hideHint(key, subkey) is called.
    const mgr = new HintManager();
    mgr.hintMap.set("key|sub", { element: undefined, timer: null } as any);
    expect(() => mgr.clear("key", "sub")).not.toThrow();
    expect(mgr.hintMap.has("key|sub")).toBe(false);
  });

  it("zIndexBase lazy-initialises on first call and reuses on subsequent calls", () => {
    // The `hintZIndex ??=` lazy-init reads the CSS token once; the second call
    // must skip the assignment. Two hint.set calls in sequence exercise both
    // branches of the `??=`.
    const mgr = new HintManager();
    mgr.set("a", "", "first", { duration: HINT_DURATION.PERSIST });
    mgr.set("b", "", "second", { duration: HINT_DURATION.PERSIST });
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(2);
  });
});

describe("hint.set / hint.clear", () => {
  it("paints a hint in its key's default slot", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
    const el = document.querySelector(".foliplus-hint");
    expect(el).not.toBeNull();
    expect(el!.textContent).toBe("hello");
  });

  it("does not touch the DOM when the same text is set again", () => {
    // The caller is expected to push its state every frame/apply; an identical
    // push must be a true no-op, not a teardown-and-rebuild.
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 0 });
    const first = document.querySelector(".foliplus-hint")!;
    mgr.set("key", "", "hello", { duration: 0 });
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(1);
    expect(document.querySelector(".foliplus-hint")).toBe(first);
    expect(first.isConnected).toBe(true);
  });

  it("rebuilds the element when the text changes", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "one", { duration: 0 });
    const first = document.querySelector(".foliplus-hint")!;
    mgr.set("key", "", "two", { duration: 0 });
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(1);
    const second = document.querySelector(".foliplus-hint")!;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.textContent).toBe("two");
  });

  it("keeps the pending timer when the text does not change", () => {
    // Re-setting the same text is not a new hint: restarting the timer would
    // make a caller that pushes every frame keep the toast alive forever.
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("key", "", "hello", { duration: 100 });
    vi.advanceTimersByTime(60);
    mgr.set("key", "", "hello", { duration: 100 });
    vi.advanceTimersByTime(41);
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("replaces the timer when the text changes", () => {
    vi.useFakeTimers();
    const mgr = new HintManager();
    mgr.set("key", "", "one", { duration: 100 });
    vi.advanceTimersByTime(80);
    mgr.set("key", "", "two", { duration: 100 });
    vi.advanceTimersByTime(60);
    // The old timer was cleared; the new one still has 40ms to run.
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("two");
    vi.advanceTimersByTime(50);
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(0);
    vi.useRealTimers();
  });

  it("keeps slots of the same key independent", () => {
    const mgr = new HintManager();
    mgr.set("key", "a", "one", { duration: 0 });
    mgr.set("key", "b", "two", { duration: 0 });
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(2);

    mgr.clear("key", "a");
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(1);
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("two");
  });

  it("clear(key) drops every slot of that key", () => {
    const mgr = new HintManager();
    mgr.set("key", "a", "one", { duration: 0 });
    mgr.set("key", "b", "two", { duration: 0 });
    mgr.set("other", "", "three", { duration: 0 });
    mgr.clear("key");
    expect(document.querySelectorAll(".foliplus-hint")).toHaveLength(1);
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("three");
  });

  it("clear on a missing key is a no-op", () => {
    const mgr = new HintManager();
    expect(() => mgr.clear("missing")).not.toThrow();
  });

  it("supports an explicit registered icon and the loading spinner", () => {
    registerHintIcon(
      "key",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    registerHintIcon("other_icon", '<svg viewBox="0 0 8 8"><circle r="2"/></svg>');
    const mgr = new HintManager();
    mgr.set("key", "", "default", { duration: 0 });
    expect(
      document.querySelector(".foliplus-hint")!.querySelector("svg rect"),
    ).not.toBeNull();

    mgr.set("key", "", "explicit", { duration: 0, icon: "other_icon" });
    expect(
      document.querySelector(".foliplus-hint")!.querySelector("svg circle"),
    ).not.toBeNull();

    mgr.set("key", "", "spinner", { duration: 0, icon: "loading" });
    expect(
      document
        .querySelector(".foliplus-hint")!
        .querySelector("svg")!
        .classList.contains("foliplus-spin"),
    ).toBe(true);

    mgr.set("key", "", "no icon", { duration: 0, icon: null });
    expect(
      document.querySelector(".foliplus-hint")!.querySelector(".foliplus-hint-icon"),
    ).toBeNull();
  });

  it("does not rebuild when only the same icon is re-set", () => {
    registerHintIcon(
      "key",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    const mgr = new HintManager();
    mgr.set("key", "", "text", { duration: 0 });
    const first = document.querySelector(".foliplus-hint")!;
    mgr.set("key", "", "text", { duration: 0 });
    expect(document.querySelector(".foliplus-hint")).toBe(first);
  });

  it("replaces the element in place, keeping the stack order of other hints", () => {
    const mgr = new HintManager();
    mgr.set("a", "", "first", { duration: 0 });
    mgr.set("b", "", "second", { duration: 0 });
    mgr.set("a", "", "first updated", { duration: 0 });
    const els = document.querySelectorAll<HTMLElement>(".foliplus-hint");
    expect(els).toHaveLength(2);
    expect(els[0].textContent).toBe("first updated");
    expect(els[1].textContent).toBe("second");
  });

  it("drops a detached previous element instead of replacing it", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "first", { duration: 0 });
    document.querySelector(".foliplus-hint")!.remove();
    expect(() => mgr.set("key", "", "second", { duration: 0 })).not.toThrow();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("second");
  });

  it("clears a slot that was never set without throwing", () => {
    const mgr = new HintManager();
    mgr.set("key", "", "text", { duration: 0 });
    expect(() => mgr.clear("key", "missing")).not.toThrow();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("text");
  });
});
describe("ensureHint", () => {
  it("attaches hint.set/hint.clear to map.foliplus", () => {
    const map = makeMap();
    ensureHint(map);
    expect(typeof map.foliplus?.hint?.set).toBe("function");
    expect(typeof map.foliplus?.hint?.clear).toBe("function");
  });

  it("is idempotent — repeated calls return the same instance", () => {
    const map = makeMap();
    const a = ensureHint(map);
    const b = ensureHint(map);
    expect(b).toBe(a);
  });

  it("exposes hint.registerIcon on map.foliplus", () => {
    const map = makeMap();
    ensureHint(map);
    expect(typeof map.foliplus!.hint.registerIcon).toBe("function");
    map.foliplus!.hint.registerIcon(
      "via_map",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    map.foliplus!.hint.set("via_map", "", "text", { duration: 0 });
    expect(document.querySelector(".foliplus-hint-icon")).not.toBeNull();
  });

  it("is per-map — separate maps get separate instances", () => {
    const mapA = makeMap();
    const mapB = makeMap();
    const a = ensureHint(mapA);
    const b = ensureHint(mapB);
    expect(a).not.toBe(b);
    a.set("key", "", "A", { duration: 0 });
    b.set("key", "", "B", { duration: 0 });
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(2);
    a.clear("key");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);
    b.clear("key");
  });

  it("syncs icons registered AFTER an existing manager was created (regression)", () => {
    // A later control's createControlEnv registers its icon after ensureHint
    // already created the manager — the new icon must appear.
    const map = makeMap();
    ensureHint(map); // manager created BEFORE the icon is registered
    registerHintIcon(
      "late_icon",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    map.foliplus!.hint.set("late_icon", "", "text", { duration: 0 });
    const icon = document.querySelector(".foliplus-hint-icon");
    expect(icon).not.toBeNull();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("text");
  });

  it("syncs icons to a manager created before registration, via syncIcons", () => {
    const mgr = new HintManager();
    const svg = '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>';
    registerHintIcon("probe", svg);
    // syncIcons was called by registerHintIcon for active managers
    expect(mgr.hintIcons["probe"]).toContain("<rect");
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
      registerHintIcon(
        name,
        `<svg viewBox="0 0 8 8" class="${name}"><rect width="4" height="4"/></svg>`,
      );
      // Clear any previously shown hint so only the current one exists.
      document.body.innerHTML = "";
      map.foliplus!.hint.set(name, "", `${name} msg`, { duration: 0 });
      const icon = document.querySelector(".foliplus-hint-icon");
      expect(icon, `${name} hint should have an icon`).not.toBeNull();
      expect(icon!.innerHTML, `${name} icon should match`).toContain(name);
    }
  });

  it("sanitises a registered icon and keeps the hint text as a TextNode", () => {
    // hint.registerIcon is a public runtime API (`map.foliplus.hint.registerIcon`)
    // whose value reaches an innerHTML sink — it must not be trusted.
    registerHintIcon(
      "dirty",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4" onmouseover="alert(1)"/></svg>',
    );
    const mgr = new HintManager();
    mgr.set("dirty", "", "<img src=x onerror=alert(1)>msg", { duration: 0 });
    const hint = document.querySelector(".foliplus-hint")!;
    const iconSpan = hint.querySelector(".foliplus-hint-icon")!;
    // The attribute is stripped from the serialised SVG.
    expect(iconSpan.innerHTML).not.toContain("onmouseover");
    // The locale text is a TextNode, never parsed as markup.
    expect(hint.querySelectorAll("img")).toHaveLength(0);
    expect(hint.textContent).toBe("<img src=x onerror=alert(1)>msg");
  });

  it("drops a registered icon that is not SVG", () => {
    registerHintIcon("not_svg", "<img src=x onerror=alert(1)>");
    const mgr = new HintManager();
    mgr.set("not_svg", "", "msg", { duration: 0 });
    expect(document.querySelector(".foliplus-hint-icon")).toBeNull();
    expect(document.querySelector(".foliplus-hint img")).toBeNull();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("msg");
  });
});

describe("map unload teardown", () => {
  it("destroys the manager on map unload, dropping the surface subscription", () => {
    vi.useFakeTimers();
    const map = makeMap();
    const mgr = ensureHint(map);
    mgr.set("persist", "", "still open", { duration: HINT_DURATION.PERSIST });
    // reattachHints is called through a bound arrow, so spying the class
    // method is the only way to observe the surface subscription afterwards.
    // The spy is created AFTER the seeding hint.set — hint.set itself calls
    // reattachHints to re-seat stranded entries, which must not count here.
    const reattachSpy = vi.spyOn(mgr, "reattachHints" as any);
    // Grab the element this manager just created. A global selector would
    // also match stray nodes left behind by sibling tests.
    const el = mgr.hintMap.values().next().value!.element;

    document.dispatchEvent(new Event("fullscreenchange"));
    expect(reattachSpy).toHaveBeenCalledTimes(1); // listener still bound
    expect(el.isConnected).toBe(true);

    expect(fire(map, "unload")).toBe(1);
    expect(mgr.hintMap.size).toBe(0);
    expect(el.isConnected).toBe(false);

    document.dispatchEvent(new Event("fullscreenchange"));
    expect(reattachSpy).toHaveBeenCalledTimes(1); // listener unbound

    // A second manager (another map on the page) proves teardown is scoped:
    // it still receives newly registered icons, and icon propagation does not
    // reach the destroyed manager.
    const other = new HintManager();
    other.set("persist", "", "other map", { duration: HINT_DURATION.PERSIST });
    registerHintIcon("late", "<svg></svg>");
    other.set("late", "", "late", { duration: HINT_DURATION.PERSIST });
    expect(other.hintMap.size).toBe(2);
    expect(mgr.hintMap.size).toBe(0); // dead manager untouched

    other.destroy();
    reattachSpy.mockRestore();
    vi.useRealTimers();
  });

  it("builds a fresh manager when the same map object is re-ensured after unload", () => {
    const map = makeMap();
    const first = ensureHint(map);
    expect(ensureHint(map)).toBe(first);

    fire(map, "unload");
    expect(first.hintMap.size).toBe(0);

    // `instances` was cleared, so a second ensureHint builds a live manager
    // instead of handing back the destroyed one.
    const second = ensureHint(map);
    expect(second).not.toBe(first);
    second.set("key", "", "again", { duration: HINT_DURATION.PERSIST });
    expect(second.hintMap.size).toBe(1);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);
    second.destroy();
  });

  it("detaches the bound hint.set closure so a call after unload warns without adding a node", () => {
    vi.useFakeTimers();
    const map = makeMap();
    const mgr = ensureHint(map);
    const { hint, warn } = unloadMap(map);

    expect(hint.set).toBeDefined();

    hint.set("key", "", "late", { duration: 0 });
    hint.set("key", "", "late", { duration: 0 });
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

  it("keeps hint.clear after unload as a silent no-op", () => {
    const map = makeMap();
    const mgr = ensureHint(map);
    const { hint, warn } = unloadMap(map);

    hint.clear("key");
    expect(warn).not.toHaveBeenCalled();
    expect(mgr.hintMap.size).toBe(0);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
    warn.mockRestore();
  });

  it("severs hint.registerIcon after unload so no global registry write survives", () => {
    // `registerHintIcon` writes into the module-level registry, which every
    // other live map reads. A post-unload call would still mutate that global
    // while the dead manager's hint.set (a copied hintIcons) never rendered
    // it — a silent half-failure, so the closure is replaced like the other two.
    // The registry itself is module-private, so assert through the public
    // seeding path: a manager built after the call would inherit the write.
    const map = makeMap();
    ensureHint(map);
    const { hint } = unloadMap(map);
    expect(typeof hint.registerIcon).toBe("function");

    hint.registerIcon("@unloaded", '<svg viewBox="0 0 8 8"><rect/></svg>');
    expect(new HintManager().hintIcons["@unloaded"]).toBeUndefined();
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(0);
  });

  it("teardown is scoped per map — a sibling map keeps its manager", () => {
    const mapA = makeMap();
    const mapB = makeMap();
    const a = ensureHint(mapA);
    const b = ensureHint(mapB);
    a.set("key", "", "A", { duration: HINT_DURATION.PERSIST });
    b.set("key", "", "B", { duration: HINT_DURATION.PERSIST });

    unloadMap(mapA);

    // mapB is untouched: same manager, node still in the DOM, still active
    // enough to receive newly registered icons.
    expect(b.hintMap.size).toBe(1);
    registerHintIcon(
      "sibling_icon",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    expect(b.hintIcons["sibling_icon"]).toContain("<rect");
    // The dead manager no longer receives icons through activeManagers.
    expect(a.hintIcons["sibling_icon"]).toBeUndefined();
    // mapA's closures were replaced, mapB's were not.
    expect(mapA.foliplus?.hint?.set).not.toBe(mapB.foliplus?.hint?.set);

    b.destroy();
  });
});
