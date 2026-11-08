// floating.ts — the shared floating-layer lifecycle primitive.
//
// The primitive owns the mount/re-pin/re-seat/wheel mechanics; the consumer
// owns the coordinate algorithm (`position`). These tests pin the lifecycle
// invariants the listbox engine and the search panel rely on.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindFloatingWheel, mountFloating } from "#platform/floating.js";

describe("bindFloatingWheel", () => {
  it("unconditionally swallows a wheel over the root", () => {
    // The shared rule: a wheel must never reach the map container, where
    // Leaflet's scrollWheelZoom would zoom the map. It holds even at a
    // boundary or with deltaY === 0 (some devices fire zero-increment events),
    // which the former boundary-aware "contain" mode let bubble.
    const root = document.createElement("div");
    Object.defineProperty(root, "scrollHeight", { value: 100, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(root, "scrollTop", { value: 0, configurable: true });
    document.body.appendChild(root);
    const onWheel = vi.fn();
    document.addEventListener("wheel", onWheel);
    try {
      bindFloatingWheel(root);
      // A wheel at the top boundary / non-scrollable root must still be swallowed.
      root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 50 }));
      expect(onWheel).not.toHaveBeenCalled();
      // deltaY === 0 (horizontal / zero-increment device) is swallowed too.
      root.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 0 }));
      expect(onWheel).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("wheel", onWheel);
      root.remove();
    }
  });
});

describe("mountFloating", () => {
  let surfaceChange: (() => void) | null;
  let host: HTMLElement;

  beforeEach(() => {
    surfaceChange = null;
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  const surface = {
    resolveHost: () => host,
    onSurfaceChange: (cb: () => void) => {
      surfaceChange = cb;
      return () => {
        surfaceChange = null;
      };
    },
  };

  it("mounts the root on the host and re-pins on a window resize", () => {
    const root = document.createElement("div");
    const position = vi.fn();
    const floating = mountFloating({ root, anchor: host, position, surface });
    expect(root.parentElement).toBe(host);
    window.dispatchEvent(new Event("resize"));
    expect(position).toHaveBeenCalledTimes(1);
    floating.release();
  });

  it("does not re-pin on a scroll that starts inside the root", () => {
    const root = document.createElement("div");
    const inner = document.createElement("div");
    root.appendChild(inner);
    document.body.appendChild(root);
    const position = vi.fn();
    const floating = mountFloating({ root, anchor: host, position, surface });
    // A scroll inside the root is the root's own overflow — it must not re-pin.
    inner.dispatchEvent(new Event("scroll", { bubbles: true }));
    expect(position).not.toHaveBeenCalled();
    floating.release();
    root.remove();
  });

  it("re-seats on the new host when the surface changes", () => {
    const root = document.createElement("div");
    const position = vi.fn();
    const nextHost = document.createElement("div");
    document.body.appendChild(nextHost);
    const floating = mountFloating({ root, anchor: host, position, surface });
    expect(root.parentElement).toBe(host);
    host = nextHost;
    surfaceChange?.();
    expect(root.parentElement).toBe(nextHost);
    expect(position).toHaveBeenCalled();
    floating.release();
    nextHost.remove();
  });

  it("release is idempotent and detaches the re-pin listeners", () => {
    const root = document.createElement("div");
    const position = vi.fn();
    const floating = mountFloating({ root, anchor: host, position, surface });
    floating.release();
    floating.release();
    expect(() => floating.release()).not.toThrow();
    // After release a resize must not re-pin.
    window.dispatchEvent(new Event("resize"));
    expect(position).not.toHaveBeenCalled();
  });
});
