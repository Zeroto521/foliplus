import { mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBundleCoverage } from "../../../script/bundle-report.mjs";

let tmpRoots: string[] = [];

const mkTmp = (): string => {
  const dir = join(
    tmpdir(),
    "bundle-report-test-" + Date.now() + "-" + Math.random().toString(36).slice(2),
  );
  tmpRoots.push(dir);
  return dir;
};

const mkDist = (root: string, files: Record<string, string>) => {
  const dir = join(root, "foliplus", "dist");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf-8");
  }
};

const writeBaselineJson = (root: string, files: Record<string, number>) => {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "size-baseline.json"),
    JSON.stringify({ version: 1, threshold: 10, files }),
    "utf-8",
  );
};

afterEach(() => {
  for (const dir of tmpRoots) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpRoots = [];
});

describe("checkBundleCoverage", () => {
  it("warns when a dist bundle is missing from the baseline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkTmp();
    mkDist(root, { "a.min.js": "x", "b.min.css": "y" });
    writeBaselineJson(root, { "a.min.js": 10 });
    checkBundleCoverage(root);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("b.min.css"));
    warn.mockRestore();
  });

  it("is silent when every bundle is covered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkTmp();
    mkDist(root, { "a.min.js": "x" });
    writeBaselineJson(root, { "a.min.js": 10 });
    checkBundleCoverage(root);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("is silent when there is no baseline", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = mkTmp();
    mkDist(root, { "a.min.js": "x" });
    checkBundleCoverage(root);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
