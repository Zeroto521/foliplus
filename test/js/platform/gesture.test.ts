// test/js/platform/gesture.test.ts — the page-level interrupt primitive.
import { afterEach, describe, expect, it, vi } from "vitest";
import { onGestureRetire } from "#platform/gesture.js";

// Every registration this file makes is released again, so the module returns
// to "no listeners bound" and the rest of the suite sees a clean page.
const releases: Array<() => void> = [];

const register = (retire: (event: Event) => void): (() => void) => {
  const release = onGestureRetire(retire);
  releases.push(release);
  return release;
};

afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks();
  const state = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  if (state) Object.defineProperty(document, "visibilityState", state);
});

describe("gesture primitive", () => {
  it("retires every consumer on a window blur", () => {
    const first = vi.fn();
    const second = vi.fn();
    register(first);
    register(second);
    window.dispatchEvent(new Event("blur"));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("releases a consumer's listener when it unregisters", () => {
    const retire = vi.fn();
    const release = onGestureRetire(retire);
    window.dispatchEvent(new Event("blur"));
    expect(retire).toHaveBeenCalledTimes(1);
    release();
    window.dispatchEvent(new Event("blur"));
    // Unregistered consumers are not called again.
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it("unregistering the same consumer twice is harmless", () => {
    const release = onGestureRetire(() => {});
    release();
    expect(() => release()).not.toThrow();
  });

  it("only fires on the transition to hidden, not on becoming visible", () => {
    const retire = vi.fn();
    register(retire);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(retire).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(retire).toHaveBeenCalledTimes(1);
  });

  it("retires on a pointercancel even when the owner stopped propagation", () => {
    // The thumb's own press handler calls stopPropagation, so a bubble-phase
    // listener on <body> would never see the cancel. The primitive listens in
    // the capture phase for exactly this reason.
    const retire = vi.fn();
    register(retire);
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    inner.addEventListener("pointercancel", event => event.stopPropagation());
    inner.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    expect(retire).toHaveBeenCalledTimes(1);
    inner.remove();
  });

  it("keeps retiring the others when one consumer throws", () => {
    const broken = vi.fn(() => {
      throw new Error("boom");
    });
    const healthy = vi.fn();
    register(broken);
    register(healthy);
    expect(() => window.dispatchEvent(new Event("blur"))).not.toThrow();
    expect(broken).toHaveBeenCalled();
    expect(healthy).toHaveBeenCalled();
  });

  it("skips a consumer that was collected without unregistering", () => {
    // The real shape: a panel drops its rows with remove() and never calls the
    // row's destroy, so the registration is the only thing keeping the callback
    // alive — which is why it is held weakly. A real collection cannot be
    // scheduled, so the weak handle is made to report "collected" from the
    // test side; production code is untouched.
    const live = vi.fn();
    register(live);
    const deref = vi.spyOn(WeakRef.prototype, "deref").mockReturnValue(undefined);

    expect(() => window.dispatchEvent(new Event("blur"))).not.toThrow();
    // The dead registration contributed no retire call.
    expect(live).not.toHaveBeenCalled();

    // The entry is pruned, not merely skipped: with every handle dead the
    // module also unbound its listeners, so a later interrupt is silent too.
    deref.mockRestore();
    expect(() => window.dispatchEvent(new Event("blur"))).not.toThrow();
  });
});
