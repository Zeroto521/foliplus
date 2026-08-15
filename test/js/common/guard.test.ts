import { requireLayerAPI, requireRuntime } from "#common/guard.js";
import { describe, expect, it, vi } from "vitest";

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

describe("requireLayerAPI", () => {
  const _ = s => s;

  it("throws when LayerAPI is missing", () => {
    vi.stubGlobal("foliplus", {
      showHint: mockShowHint,
      HINT_DURATION: { PERSIST: 0 },
    });
    vi.stubGlobal("map", {});
    expect(() => requireLayerAPI("Test", _, window.map)).toThrow(
      "Test.no_layercontrol",
    );
    expect(mockShowHint).toHaveBeenCalledWith("Test", "Test.no_layercontrol", 0);
  });

  it("passes when LayerAPI is present", () => {
    vi.stubGlobal("foliplus", { showHint: () => {} });
    vi.stubGlobal("map", { foliplus: { LayerAPI: {} } });
    expect(() => requireLayerAPI("Test", _, window.map)).not.toThrow();
  });
});
