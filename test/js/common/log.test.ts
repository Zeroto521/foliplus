// common/log — namespaced console logger. Covers the `[<name>] ` prefix shape
// and that every argument is forwarded to the underlying console method.
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "#common/log.js";

describe("log", () => {
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
