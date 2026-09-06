import { describe, expect, it, vi } from "vitest";
import { requireRuntime } from "#common/guard.js";

describe("requireRuntime", () => {
  it("throws when foliplus is missing", () => {
    vi.stubGlobal("foliplus", undefined);

    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("throws when foliplus is missing", () => {
    vi.stubGlobal("foliplus", undefined);

    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("passes when foliplus.showHint is available", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });

    expect(() => requireRuntime("Test")).not.toThrow();
  });
});
