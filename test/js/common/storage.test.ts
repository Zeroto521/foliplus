import { beforeEach, describe, expect, it, vi } from "vitest";
import { load, save } from "#common/storage.js";

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
});
