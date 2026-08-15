import { createControlEnv, requireRuntime } from "#common/guard.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockShowHint = vi.fn();

describe("requireRuntime", () => {
  it("throws when foliplus is missing", () => {
    vi.stubGlobal("foliplus", undefined);
    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("throws when showHint is not a function", () => {
    vi.stubGlobal("foliplus", {});
    expect(() => requireRuntime("Test")).toThrow("foliplus runtime not found");
  });

  it("passes when foliplus.showHint is available", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
    expect(() => requireRuntime("Test")).not.toThrow();
  });
});
