import {
  patchBringToFront,
  unpatchBringToFront,
} from "#foliplus/LayerControl/manager.js";
import { describe, expect, it } from "vitest";

// The L mock in test/js/setup.ts provides `L.Path.prototype.bringToFront` as a
// vi.fn() BEFORE this module imports manager.js, so `origBringToFront` is stable
// within this file. Each test restores the module-level refcount to zero.

describe("bringToFront patch refcounting", () => {
  it("patch is idempotent; unpatch restores only at zero refcount", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    try {
      patchBringToFront();
      patchBringToFront();
      expect(proto.bringToFront).not.toBe(base);
      unpatchBringToFront();
      expect(proto.bringToFront).not.toBe(base); // second instance still patched
      unpatchBringToFront();
      expect(proto.bringToFront).toBe(base); // last instance restored
    } finally {
      // leave the module counter at zero even if an assertion failed
      unpatchBringToFront();
      unpatchBringToFront();
      proto.bringToFront = base;
    }
  });

  it("guarded bringToFront skips detached paths without throwing", () => {
    const proto = window.L.Path.prototype;
    const base = proto.bringToFront;
    patchBringToFront();
    try {
      const guarded = proto.bringToFront as unknown as (this: unknown) => unknown;
      // _path missing / detached → no-op, returns this
      expect(() => guarded.call({})).not.toThrow();
      expect(() => guarded.call({ _path: null })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: null } })).not.toThrow();
      expect(() => guarded.call({ _path: { parentNode: {} } })).not.toThrow();
    } finally {
      unpatchBringToFront();
      proto.bringToFront = base;
    }
  });
});
