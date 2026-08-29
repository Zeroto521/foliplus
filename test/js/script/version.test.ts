import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveVersion caches at module level, so reset modules before each test to
// get a fresh cache, then mock child_process before importing.
beforeEach(() => {
  vi.resetModules();
});

const importFresh = () => import("../../../script/version.mjs");

// child_process is a CJS module — provide both the named export and `default`
// so the mock satisfies ESM interop (version.mjs does `import { spawnSync }`).
const mockChildProcess = (
  impl: (cmd: string) => { status: number; stdout: string },
) => {
  const spawnSync = vi.fn(impl);
  vi.doMock("child_process", () => ({ default: { spawnSync }, spawnSync }));
};

describe("resolveVersion", () => {
  it("returns the installed foliplus.__version__", async () => {
    const { resolveVersion } = await importFresh();
    const v = resolveVersion();
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(0);
  });

  it("falls back to git describe when python import fails", async () => {
    mockChildProcess(cmd =>
      cmd === "git"
        ? { status: 0, stdout: "v0.3.1-85-gabcdef" }
        : { status: 1, stdout: "" },
    );
    const { resolveVersion } = await importFresh();
    expect(resolveVersion()).toBe("v0.3.1-85-gabcdef");
  });

  it("returns unknown when neither python nor git resolve", async () => {
    mockChildProcess(() => ({ status: 1, stdout: "" }));
    const { resolveVersion } = await importFresh();
    expect(resolveVersion()).toBe("unknown");
  });

  it("caches the resolved version (no repeat subprocess)", async () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: "0.3.2.dev1\n" }));
    vi.doMock("child_process", () => ({ default: { spawnSync }, spawnSync }));
    const { resolveVersion } = await importFresh();
    expect(resolveVersion()).toBe("0.3.2.dev1");
    expect(resolveVersion()).toBe("0.3.2.dev1"); // served from the module cache
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});
