import { beforeEach, describe, expect, it, vi } from "vitest";
import { createControlEnv } from "#core/lifecycle/index.js";
import { registerHintIcon } from "#core/overlay/index.js";

vi.mock("#core/overlay/index.js", () => ({
  registerHintIcon: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(registerHintIcon).mockClear();
  vi.stubGlobal("foliplus", { showHint: vi.fn() });
});

describe("createControlEnv", () => {
  it("registers the hint icon when provided", () => {
    createControlEnv({ name: "MeasureControl" }, "<svg/>");
    expect(registerHintIcon).toHaveBeenCalledTimes(1);
    expect(registerHintIcon).toHaveBeenCalledWith("MeasureControl", "<svg/>");
  });

  it("skips icon registration when icon is omitted (ScaleControl)", () => {
    createControlEnv({ name: "ScaleControl" });
    expect(registerHintIcon).not.toHaveBeenCalled();
  });

  it("throws when runtime is missing", () => {
    vi.stubGlobal("foliplus", undefined);
    expect(() => createControlEnv({ name: "ScaleControl" })).toThrow(
      "foliplus runtime not found",
    );
    expect(registerHintIcon).not.toHaveBeenCalled();
  });
});
