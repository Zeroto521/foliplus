import {
  HINT_DURATION,
  HintManager,
  ensureHint,
  registerHintIcon,
} from "#core/hint.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    registerHintIcon("late_icon", "<svg></svg>");
    map.foliplus.showHint("late_icon", "text", 0);
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
});
