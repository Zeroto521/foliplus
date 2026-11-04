import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  assertNoSurvivorMarker,
  planDistMarker,
  settleDistMarker,
} from "#script/build/distMarker.mjs";

// The plan/settle/assert contract that lets bundle-fuse/bundle-size-check/
// browser-probe skip their absolute-cap cases on a successful dev build and
// fail loudly otherwise. Isolated in script/build/distMarker.mjs so it is
// testable without importing build.mjs's CFG/argv-driven entry. Each case uses
// its own mkdtemp distDir so the assertions never touch the real foliplus/dist.
describe("dist-mode marker lifecycle", () => {
  const withDist = (fn: (distDir: string) => void) => {
    const distDir = mkdtempSync(join(tmpdir(), "dist-marker-"));
    try {
      fn(distDir);
    } finally {
      rmSync(distDir, { recursive: true, force: true });
    }
  };

  it("dev build creates the dist dir and writes a dev marker", () => {
    // The 3a0ccb2f regression: a clean checkout has no dist/ yet, and a bare
    // writeFileSync would throw ENOENT. planDistMarker must mkdir first.
    withDist(distDir => {
      rmSync(distDir, { recursive: true, force: true });
      const marker = planDistMarker({ dev: true, distDir });
      expect(existsSync(distDir)).toBe(true);
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, "utf-8")).toBe("dev");
    });
  });

  it("minified build clears a stale marker up front", () => {
    withDist(distDir => {
      const marker = planDistMarker({ dev: true, distDir });
      expect(existsSync(marker)).toBe(true);
      planDistMarker({ dev: false, distDir });
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("settle removes the marker on a failed dev build", () => {
    withDist(distDir => {
      const marker = planDistMarker({ dev: true, distDir });
      settleDistMarker({ dev: true, buildOk: false, marker });
      expect(existsSync(marker)).toBe(false);
    });
  });

  it("settle keeps the marker on a successful dev build", () => {
    withDist(distDir => {
      const marker = planDistMarker({ dev: true, distDir });
      settleDistMarker({ dev: true, buildOk: true, marker });
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, "utf-8")).toBe("dev");
    });
  });

  it("assertNoSurvivorMarker throws when a marker survives a minified build", () => {
    withDist(distDir => {
      const marker = planDistMarker({ dev: false, distDir });
      writeFileSync(marker, "dev", "utf-8");
      expect(() => assertNoSurvivorMarker({ dev: false, marker })).toThrow(
        /survived a minified build/,
      );
    });
  });

  it("assertNoSurvivorMarker does not throw on a dev build", () => {
    withDist(distDir => {
      const marker = planDistMarker({ dev: true, distDir });
      expect(() => assertNoSurvivorMarker({ dev: true, marker })).not.toThrow();
    });
  });
});
