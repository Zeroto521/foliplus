import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import setupFixture from "./emit-config-fixture-setup.mjs";

// The fixture is generated from foliplus/_config_schema.py, so a stale committed copy
// silently mismatches the schema. Every vitest entry point must therefore
// regenerate it before any test runs — hence a globalSetup rather than an npm
// `pretest` hook, which only covers `npm test`.

// Repo root via vitest's cwd (the convention build.test.ts uses too).
const ROOT = process.cwd();
const FIXTURE = resolve(ROOT, "test", "js", "config-fixture.ts");
const configText = readFileSync(resolve(ROOT, "vitest.config.mjs"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

describe("emit-config-fixture-setup", () => {
  it("is wired as the vitest globalSetup and not to an npm pretest hook", () => {
    expect(configText).toMatch(
      /globalSetup:\s*\[\s*"test\/js\/script\/emit-config-fixture-setup\.mjs"/,
    );
    expect(pkg.scripts.pretest).toBeUndefined();
  });

  it("runs the generator and leaves the committed fixture unchanged", () => {
    const committed = readFileSync(FIXTURE, "utf8");
    expect(committed).toContain("function makeConfig(");

    // No throw, and the committed file is byte-identical afterwards: the
    // generator reproduces exactly what is committed.
    setupFixture();
    expect(readFileSync(FIXTURE, "utf8")).toBe(committed);
  });
});

describe("emit-config-fixture-setup failure paths", () => {
  // child_process is a CJS module — provide both the named export and `default`
  // so the mock satisfies ESM interop (the setup does `import { spawnSync }`).
  const mockSpawn = (impl: () => unknown) => {
    const spawnSync = vi.fn(impl);
    vi.doMock("child_process", () => ({
      default: { spawnSync },
      spawnSync,
    }));
  };

  const importFresh = () => {
    vi.resetModules();
    return import("./emit-config-fixture-setup.mjs");
  };

  afterEach(() => {
    vi.doUnmock("child_process");
    vi.restoreAllMocks();
  });

  it("rethrows the spawn error so vitest aborts the run", async () => {
    // A broken interpreter is not recoverable: a swallowed error would let the
    // suite read a stale fixture and report green on the wrong contract.
    mockSpawn(() => ({ error: new Error("spawn ENOENT") }));
    const setup = (await importFresh()).default;
    expect(() => setup()).toThrow("spawn ENOENT");
  });

  it("surfaces the generator's stderr", async () => {
    mockSpawn(() => ({ status: 0, stderr: "generator failed" }));
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const setup = (await importFresh()).default;
    setup();
    expect(stderr).toHaveBeenCalledWith("generator failed");
  });

  it("exits with the generator's status when it is non-zero", async () => {
    mockSpawn(() => ({ status: 3 }));
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit:3");
    });
    const setup = (await importFresh()).default;
    expect(() => setup()).toThrow("exit:3");
    expect(exit).toHaveBeenCalledWith(3);
  });
});
