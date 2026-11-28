// test/js/runtime/index.test.ts — the shared runtime's mixed-build guard.
//
// The shared runtime is inlined once per map, but a page can still execute two
// builds of it (two foliplus versions rendered into one HTML). The first build
// initializes the global namespace; the second is a silent no-op today, which is
// exactly the mixed behaviour the guard reports. These tests re-import the
// module with a different build-time __FOLIPLUS_VERSION__ and assert one
// warning per mismatch, none for a same-build reload, and the diagnostic hook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FoliplusGlobal = typeof window.foliplus;

const loadRuntime = async (version: string): Promise<void> => {
  vi.resetModules();
  vi.stubGlobal("__FOLIPLUS_VERSION__", version);
  await import("#foliplus/runtime/index.js");
};

const resetNamespace = (): void => {
  delete (window as unknown as { foliplus?: FoliplusGlobal }).foliplus;
};

const installErrorHook = (onError: (event: string, error: unknown) => void): void => {
  (window as unknown as { foliplus?: { onError?: typeof onError } }).foliplus = {
    onError,
  };
};

describe("runtime mixed-build guard", () => {
  beforeEach(() => {
    resetNamespace();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("initializes the namespace from the first build without warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("1.0.0");
    expect(window.foliplus.version).toBe("1.0.0");
    expect(window.foliplus.isInitialized).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once when an older build loads after a newer one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("2.0.0");
    await loadRuntime("1.0.0");
    // The first build stays authoritative — the guard reports, it does not
    // re-initialize shared modules against a second build.
    expect(window.foliplus.version).toBe("2.0.0");
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain("mixed foliplus builds");
    expect(message).toContain("1.0.0");
    expect(message).toContain("2.0.0");
  });

  it("warns once when a newer build loads after an older one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("1.0.0");
    await loadRuntime("2.0.0");
    expect(window.foliplus.version).toBe("1.0.0");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not warn when the same build loads twice", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("1.0.0");
    await loadRuntime("1.0.0");
    expect(warn).not.toHaveBeenCalled();
  });

  it("reports through the global diagnostic hook with event runtime", async () => {
    const onError = vi.fn();
    installErrorHook(onError);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("2.0.0");
    await loadRuntime("1.0.0");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBe("runtime");
    expect(onError.mock.calls[0][1]).toBeInstanceOf(Error);
  });

  it("a throwing diagnostic hook never takes the runtime down", async () => {
    const onError = vi.fn(() => {
      throw new Error("host hook boom");
    });
    installErrorHook(onError);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadRuntime("2.0.0");
    await loadRuntime("1.0.0");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
