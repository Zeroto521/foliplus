// common/log — namespaced diagnostics. Covers the `[<name>] ` log shape, the
// `[<name>]: ` throw shape, argument forwarding, and that a thrown value keeps
// its native constructor (instanceof, message, name, stack).
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, fail, failError, failType, makeError, makeTypeError } from "#common/log.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createLogger", () => {
  it("warn() prefixes with [<name>] and forwards args", () => {
    const warn = vi.fn();
    vi.stubGlobal("console", { warn });
    const err = new Error("boom");
    createLogger("MeasureControl").warn("export failed:", err);
    expect(warn).toHaveBeenCalledWith("[MeasureControl] export failed:", err);
  });

  it("error() prefixes with [<name>] and forwards args", () => {
    const error = vi.fn();
    vi.stubGlobal("console", { error });
    createLogger("foliplus").error("gcoord library failed to load", "GCJ02");
    expect(error).toHaveBeenCalledWith(
      "[foliplus] gcoord library failed to load",
      "GCJ02",
    );
  });

  it("warn() and error() share one bound prefix", () => {
    const warn = vi.fn();
    const error = vi.fn();
    vi.stubGlobal("console", { warn, error });
    const log = createLogger("LayerControl");
    log.warn("first");
    log.error("second");
    expect(warn).toHaveBeenCalledWith("[LayerControl] first");
    expect(error).toHaveBeenCalledWith("[LayerControl] second");
  });
});

describe("fail helpers", () => {
  it("failError() throws Error with a [<name>]: prefix", () => {
    expect(() => failError("ExportControl", "crop too small")).toThrow(
      "[ExportControl]: crop too small",
    );
  });

  it("failType() throws TypeError with a [<name>]: prefix", () => {
    expect(() => failType("MeasureControl", "point has no lng/lat")).toThrow(
      "[MeasureControl]: point has no lng/lat",
    );
  });

  it("fail() throws whatever constructor it is given", () => {
    expect(() => fail(Error, "foliplus", "boom")).toThrow("[foliplus]: boom");
    expect(() => fail(TypeError, "foliplus", "boom")).toThrow("[foliplus]: boom");
  });

  it("keeps the native constructor on the thrown value", () => {
    try {
      failType("MeasureControl", "point has no lng/lat");
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as Error).message).toBe("[MeasureControl]: point has no lng/lat");
      expect((e as Error).name).toBe("TypeError");
      expect(typeof (e as Error).stack).toBe("string");
    }

    try {
      failError("ExportControl", "crop too small");
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(TypeError);
      expect((e as Error).name).toBe("Error");
    }
  });
});

describe("makeError / makeTypeError", () => {
  it("makeTypeError() returns a class whose instances are TypeErrors", () => {
    const ctor = makeTypeError("LayerRegistry");
    const e = new ctor("cannot delete layers directly");
    expect(e).toBeInstanceOf(TypeError);
    expect(e.message).toBe("[LayerRegistry]: cannot delete layers directly");
    expect(e.name).toBe("TypeError");
    expect(typeof e.stack).toBe("string");
  });

  it("makeError() is usable from a closure that throws later (Proxy trap shape)", () => {
    const ctor = makeError(TypeError, "LayerRegistry");
    const trap = () => {
      throw new ctor(`read-only method "push" is blocked`);
    };
    expect(trap).toThrow("[LayerRegistry]: read-only method \"push\" is blocked");
    try {
      trap();
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
    }
  });
});
