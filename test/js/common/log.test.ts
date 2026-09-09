// common/log — namespaced diagnostics. Covers the `[<name>] ` shape shared by
// log lines and thrown messages, plus argument forwarding. Thrown values stay
// plain `new Error(...)` / `new TypeError(...)`, so instanceof/name/stack come
// from the runtime, not from here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "#common/log.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("msg", () => {
  it("prefixes with a space separator", () => {
    expect(createLogger("MeasureControl").msg("point has no lng/lat")).toBe(
      "[MeasureControl] point has no lng/lat",
    );
  });

  it("keeps the prefix on quoted messages", () => {
    expect(
      createLogger("LayerRegistry").msg('read-only method "push" is blocked'),
    ).toBe('[LayerRegistry] read-only method "push" is blocked');
  });
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

describe("one shape, two deliveries", () => {
  it("a log line and a thrown message differ only in delivery", () => {
    const warn = vi.fn();
    vi.stubGlobal("console", { warn });
    const log = createLogger("LayerControl");
    log.warn("dropped stale ids");
    expect(warn).toHaveBeenCalledWith("[LayerControl] dropped stale ids");
    expect(log.msg("dropped stale ids")).toBe("[LayerControl] dropped stale ids");
  });
});
