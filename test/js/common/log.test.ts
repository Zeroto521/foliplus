// common/log — namespaced diagnostics. Covers the `[<name>] ` log shape, the
// `[<name>]: ` throw shape, and argument forwarding. Thrown values stay plain
// `new Error(...)` / `new TypeError(...)`, so instanceof/name/stack come from the
// runtime, not from here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "#common/log.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("msg", () => {
  it("joins with a colon separator", () => {
    expect(createLogger("MeasureControl").msg("point has no lng/lat")).toBe(
      "[MeasureControl]: point has no lng/lat",
    );
  });

  it("keeps the prefix on quoted messages", () => {
    expect(createLogger("LayerRegistry").msg('read-only method "push" is blocked')).toBe(
      '[LayerRegistry]: read-only method "push" is blocked',
    );
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

describe("separator contrast", () => {
  it("log lines and thrown messages read differently", () => {
    // A log is a statement; an error message is the stack trace's heading.
    const warn = vi.fn();
    vi.stubGlobal("console", { warn });
    createLogger("LayerControl").warn("dropped stale ids");
    expect(warn).toHaveBeenCalledWith("[LayerControl] dropped stale ids");
    expect(createLogger("LayerControl").msg("dropped stale ids")).toBe(
      "[LayerControl]: dropped stale ids",
    );
  });
});
