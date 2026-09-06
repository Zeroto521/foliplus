import { beforeEach, describe, expect, it, vi } from "vitest";

// resolveVersion caches at module level, so reset modules before each test to
// get a fresh cache, then mock child_process before importing.
beforeEach(() => {
  vi.resetModules();
});

const importFresh = () => import("#script/version.mjs");

// child_process is a CJS module — provide both the named export and `default`
// so the mock satisfies ESM interop (version.mjs does `import { spawnSync }`).
const mockChildProcess = (
  impl: (cmd: string) => { status: number; stdout: string },
) => {
  const spawnSync = vi.fn(impl);

  vi.doMock("child_process", () => ({ default: { spawnSync }, spawnSync }));
};

describe("resolveVersion", () => {
  it("returns git describe", async () => {
    mockChildProcess(() => ({ status: 0, stdout: "v0.3.1-85-gabcdef\n" }));
    const { resolveVersion } = await importFresh();

    expect(resolveVersion()).toBe("v0.3.1-85-gabcdef");
  });

  it("returns unknown when git describe fails", async () => {
    mockChildProcess(() => ({ status: 1, stdout: "" }));
    const { resolveVersion } = await importFresh();

    expect(resolveVersion()).toBe("unknown");
  });

  it("caches the resolved version (no repeat subprocess)", async () => {
    const spawnSync = vi.fn(() => ({ status: 0, stdout: "v0.3.1-85-gabcdef\n" }));

    vi.doMock("child_process", () => ({ default: { spawnSync }, spawnSync }));
    const { resolveVersion } = await importFresh();

    expect(resolveVersion()).toBe("v0.3.1-85-gabcdef");

    expect(resolveVersion()).toBe("v0.3.1-85-gabcdef"); // served from the module cache

    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
});
