/**
 * Dist-mode marker for the dist-dependent tests (bundle-fuse, bundle-size-check,
 * browser-probe): build:dev emits unminified output larger than the minified
 * ceilings those tests assert, so the absolute-cap cases skip only on a successful
 * dev build.
 *
 * Decided at the START: a minified build clears the marker before building (a
 * mid-build failure cannot leave a stale dev marker that would silently skip the
 * cap cases), and a dev build writes it up front and removes it again in the
 * finally below if the build fails (its dist is partial unminified output; the cap
 * cases must run and fail loudly, not skip).
 *
 * This module is deliberately free of side effects and of build.mjs's CFG/argv
 * parsing, so the lifecycle is unit-testable without importing the build entry.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DIST_MARKER = ".dev-build";

/**
 * Write (dev) or clear (minified) the marker before the build runs.
 * Returns the marker path so the caller can settle/assert it afterwards.
 */
const planDistMarker = ({ dev, distDir }) => {
  const marker = resolve(distDir, DIST_MARKER);
  if (dev) {
    // A clean checkout has no dist/ yet; create it before writing the marker or
    // writeFileSync throws ENOENT and the whole dev build dies on first run.
    mkdirSync(distDir, { recursive: true });
    writeFileSync(marker, "dev", "utf-8");
  } else {
    rmSync(marker, { force: true });
  }
  return marker;
};

/**
 * After the build settles: a dev build keeps the marker only when it succeeded
 * (its dist is real unminified output the cap cases may skip on); a failed dev
 * build or any minified build removes it so the cap cases run and fail loudly.
 */
const settleDistMarker = ({ dev, buildOk, marker }) => {
  if (!(dev && buildOk)) rmSync(marker, { force: true });
};

/**
 * Survivor guard: a marker present after a minified build means the clear-in-
 * the-finally was skipped, so a stale dev marker would silently skip the cap
 * cases on the next run. Fail loudly instead.
 */
const assertNoSurvivorMarker = ({ dev, marker }) => {
  if (!dev && existsSync(marker)) {
    throw new Error(".dev-build marker survived a minified build");
  }
};

export { DIST_MARKER, planDistMarker, settleDistMarker, assertNoSurvivorMarker };
