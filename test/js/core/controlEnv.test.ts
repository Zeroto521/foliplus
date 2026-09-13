import { beforeEach, describe, expect, it, vi } from "vitest";
import { createControlEnv } from "#core/controlEnv.js";
import { registerHintIcon } from "#core/hint.js";
import { LOADING } from "#common/icon.js";

vi.mock("#core/hint.js", () => ({
  registerHintIcon: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(registerHintIcon).mockClear();
  vi.stubGlobal("foliplus", { showHint: vi.fn() });
});

describe("createControlEnv", () => {
  it("registers the hint icon and the spinner under <name>-loading", () => {
    createControlEnv({ name: "MeasureControl" }, "<svg/>");
    expect(registerHintIcon).toHaveBeenCalledTimes(2);
    expect(registerHintIcon).toHaveBeenCalledWith("MeasureControl", "<svg/>");
    expect(registerHintIcon).toHaveBeenCalledWith("MeasureControl-loading", LOADING);
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
