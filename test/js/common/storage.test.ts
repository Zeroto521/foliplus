import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  load,
  loadVersioned,
  makePersisted,
  save,
  saveVersioned,
} from "#common/storage.js";

// jsdom implements Storage#getOwnPropertyDescriptor as a trap that throws on
// any descriptor rewrite, so vi.spyOn(localStorage, "setItem") silently no-ops
// — the native method keeps running and the stub never fires. Replace the
// property descriptor instead, and restore it after each failing test.
let restore: (() => void) | undefined;
const runWithSetItem = (
  implementation: (key: string, value: string) => void,
  fn: () => void,
): void => {
  const descriptor = Object.getOwnPropertyDescriptor(
    Storage.prototype,
    "setItem",
  ) as PropertyDescriptor;
  restore = () => Object.defineProperty(Storage.prototype, "setItem", descriptor);
  Object.defineProperty(Storage.prototype, "setItem", {
    configurable: true,
    value: implementation,
  });
  try {
    fn();
  } finally {
    restore();
    restore = undefined;
  }
};

afterEach(() => {
  restore?.();
});

describe("storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("console", { warn: vi.fn() });
  });

  it("returns null when key does not exist", () => {
    expect(load("nonexistent")).toBeNull();
  });

  it("saves and loads JSON values", () => {
    save("test_key", { foo: "bar" });
    expect(load("test_key")).toEqual({ foo: "bar" });
  });

  it("returns null for corrupted JSON", () => {
    window.localStorage.setItem("bad", "not json");
    expect(load("bad")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("handles primitive values", () => {
    save("num", 42);
    expect(load("num")).toBe(42);
  });

  it("reports a write as landed on the default path", () => {
    expect(save("ok", { a: 1 })).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("reports false when the backend rejects with QuotaExceededError", () => {
    runWithSetItem(
      () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      () => {
        expect(save("denied", { a: 1 })).toBe(false);
        expect(console.warn).toHaveBeenCalled();
      },
    );
  });

  it("surfaces any rejected write, not only quota exhaustion", () => {
    // Security policies, private-mode restrictions, and the Storage Event API's
    // synchronous throw all surface as non-Quota errors.
    runWithSetItem(
      () => {
        throw new Error("blocked");
      },
      () => {
        expect(save("blocked", { a: 1 })).toBe(false);
      },
    );
  });

  it("still reports a write as landed when the backend swallows it", () => {
    // Some sandboxed iframes accept a write and drop it without throwing —
    // save() can only observe a throw, so that case reports landed.
    runWithSetItem(
      () => {},
      () => {
        expect(save("silent", { a: 1 })).toBe(true);
        expect(console.warn).not.toHaveBeenCalled();
      },
    );
  });

  describe("saveVersioned", () => {
    it("writes a versioned envelope with the default data field", () => {
      expect(saveVersioned("k", [1, 2], 1)).toBe(true);
      expect(JSON.parse(window.localStorage.getItem("k")!)).toEqual({
        version: 1,
        data: [1, 2],
      });
    });

    it("respects a custom data field", () => {
      saveVersioned("k", [1, 2], 1, "Measure", "items");
      expect(JSON.parse(window.localStorage.getItem("k")!)).toEqual({
        version: 1,
        items: [1, 2],
      });
    });

    it("reports false when the backend rejects", () => {
      runWithSetItem(
        () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
        () => {
          expect(saveVersioned("k", [1], 1)).toBe(false);
        },
      );
    });
  });

  describe("loadVersioned", () => {
    it("unwraps a versioned envelope with the default data field", () => {
      window.localStorage.setItem("k", JSON.stringify({ version: 1, data: [1, 2] }));
      expect(loadVersioned("k")).toEqual([1, 2]);
    });

    it("unwraps a versioned envelope with a custom data field", () => {
      window.localStorage.setItem("k", JSON.stringify({ version: 1, items: [1, 2] }));
      expect(loadVersioned<unknown>("k", "Measure", "items")).toEqual([1, 2]);
    });

    it("returns a legacy bare array as-is", () => {
      window.localStorage.setItem("k", JSON.stringify([1, 2]));
      expect(loadVersioned("k")).toEqual([1, 2]);
    });

    it("returns null when the key is missing", () => {
      expect(loadVersioned("k")).toBeNull();
    });

    it("returns null for corrupted JSON", () => {
      window.localStorage.setItem("k", "not json");
      expect(loadVersioned("k")).toBeNull();
    });

    it("returns null for a non-array, non-object value", () => {
      window.localStorage.setItem("k", JSON.stringify("string"));
      expect(loadVersioned("k")).toBeNull();
    });

    it("returns null for an object whose data field is missing", () => {
      window.localStorage.setItem("k", JSON.stringify({ version: 1 }));
      expect(loadVersioned("k")).toBeNull();
    });

    it("returns null for an object whose data field is not an array", () => {
      window.localStorage.setItem(
        "k",
        JSON.stringify({ version: 1, data: "not-array" }),
      );
      expect(loadVersioned("k")).toBeNull();
    });
  });

  describe("makePersisted", () => {
    it("writes through synchronously with debounceMs=0", () => {
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 0,
      });
      p.schedule();
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("coalesces writes with debounceMs>0", () => {
      vi.useFakeTimers();
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 100,
      });
      p.schedule();
      p.schedule();
      p.schedule();
      expect(saveMock).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(saveMock).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("flush writes immediately regardless of pending timer", () => {
      vi.useFakeTimers();
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 100,
      });
      p.schedule();
      p.flush();
      expect(saveMock).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(100);
      expect(saveMock).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("flush is idempotent", () => {
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 0,
      });
      p.flush();
      p.flush();
      expect(saveMock).toHaveBeenCalledTimes(2);
    });

    it("cancel drops a pending write", () => {
      vi.useFakeTimers();
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 100,
      });
      p.schedule();
      p.cancel();
      vi.advanceTimersByTime(200);
      expect(saveMock).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("cancel is a no-op with write-through", () => {
      const saveMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: saveMock,
        debounceMs: 0,
      });
      p.schedule();
      p.cancel();
      expect(saveMock).toHaveBeenCalledTimes(1);
    });

    it("calls onFlushError when save throws during flush", () => {
      const onFlushError = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: () => {
          throw new Error("quota");
        },
        debounceMs: 0,
        onFlushError,
      });
      p.flush();
      expect(onFlushError).toHaveBeenCalledWith(new Error("quota"));
    });

    it("does not call onFlushError when save succeeds", () => {
      const onFlushError = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: vi.fn(),
        save: vi.fn(),
        debounceMs: 0,
        onFlushError,
      });
      p.flush();
      expect(onFlushError).not.toHaveBeenCalled();
    });

    it("exposes load as a pass-through", () => {
      const loadMock = vi.fn();
      const p = makePersisted("k", {
        version: 1,
        load: loadMock,
        save: vi.fn(),
      });
      p.load();
      expect(loadMock).toHaveBeenCalledTimes(1);
    });
  });
});
