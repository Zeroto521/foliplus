import { describe, expect, it, vi, beforeEach } from "vitest";
import { load, save } from "../../foliplus/js/common/storage.js";

describe("storage", () => {
  beforeEach(() => {
    localStorage.clear();
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
    localStorage.setItem("bad", "not json");
    expect(load("bad")).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("handles primitive values", () => {
    save("num", 42);
    expect(load("num")).toBe(42);
  });
});
