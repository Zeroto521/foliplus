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
    registerHintIcon("with_icon", '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>');
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
    const map = { foliplus: {} } as any;
    ensureHint(map);
    expect(typeof map.foliplus.showHint).toBe("function");
    expect(typeof map.foliplus.hideHint).toBe("function");
  });

  it("is idempotent — repeated calls return the same instance", () => {
    const map = { foliplus: {} } as any;
    const a = ensureHint(map);
    const b = ensureHint(map);
    expect(b).toBe(a);
  });

  it("exposes registerHintIcon on map.foliplus", () => {
    const map = { foliplus: {} } as any;
    ensureHint(map);
    expect(typeof map.foliplus.registerHintIcon).toBe("function");
    map.foliplus.registerHintIcon(
      "via_map",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    map.foliplus.showHint("via_map", "text", 0);
    expect(document.querySelector(".foliplus-hint-icon")).not.toBeNull();
  });

  it("is per-map — separate maps get separate instances", () => {
    const mapA = {} as any;
    const mapB = {} as any;
    const a = ensureHint(mapA);
    const b = ensureHint(mapB);
    expect(a).not.toBe(b);
    a.showHint("key", "A", 0);
    b.showHint("key", "B", 0);
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(2);
    a.hideHint("key");
    expect(document.querySelectorAll(".foliplus-hint").length).toBe(1);
  });

  it("syncs icons registered AFTER an existing manager was created (regression)", () => {
    // A later control's createControlEnv registers its icon after ensureHint
    // already created the manager — the new icon must appear.
    const map = {} as any;
    ensureHint(map); // manager created BEFORE the icon is registered
    registerHintIcon(
      "late_icon",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4"/></svg>',
    );
    map.foliplus.showHint("late_icon", "text", 0);
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
    const map = {} as any;
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
        '<svg viewBox="0 0 8 8" class="' + name + '"><rect width="4" height="4"/></svg>',
      );
      // Clear any previously shown hint so only the current one exists.
      document.body.innerHTML = "";
      map.foliplus.showHint(name, name + " msg", 0);
      const icon = document.querySelector(".foliplus-hint-icon");
      expect(icon, name + " hint should have an icon").not.toBeNull();
      expect(icon!.innerHTML, name + " icon should match").toContain(name);
    }
  });

  it("sanitises a registered icon and keeps the hint text as a TextNode", () => {
    // registerHintIcon is a public runtime API (`map.foliplus.registerHintIcon`)
    // whose value reaches an innerHTML sink — it must not be trusted.
    registerHintIcon(
      "dirty",
      '<svg viewBox="0 0 8 8"><rect width="4" height="4" onmouseover="alert(1)"/></svg>',
    );
    const mgr = new HintManager();
    mgr.showHint("dirty", "<img src=x onerror=alert(1)>msg", 0);
    const hint = document.querySelector(".foliplus-hint")!;
    const iconSpan = hint.querySelector(".foliplus-hint-icon")!;
    // The attribute is stripped from the serialised SVG.
    expect(iconSpan.innerHTML).not.toContain("onmouseover");
    // The locale text is a TextNode, never parsed as markup.
    expect(hint.querySelectorAll("img")).toHaveLength(0);
    expect(hint.textContent).toBe("<img src=x onerror=alert(1)>msg");
  });

  it("drops a registered icon that is not SVG", () => {
    registerHintIcon("not_svg", '<img src=x onerror=alert(1)>');
    const mgr = new HintManager();
    mgr.showHint("not_svg", "msg", 0);
    expect(document.querySelector(".foliplus-hint-icon")).toBeNull();
    expect(document.querySelector(".foliplus-hint img")).toBeNull();
    expect(document.querySelector(".foliplus-hint")!.textContent).toBe("msg");
  });
});
