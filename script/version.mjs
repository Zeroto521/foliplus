/**
 * Resolve the foliplus version for build banners and the size baseline.
 *
 * Uses `git describe` (tag + distance + commit) — identical in local dev and
 * CI, so the version string never differs between environments. Shared by
 * `build.mjs` and `bundle-size-check.mjs`.
 */
import { spawnSync } from "child_process";

let versionCache = null;

export const resolveVersion = () => {
  if (versionCache) return versionCache;
  const git = spawnSync("git", ["describe", "--tags", "--always", "--dirty"], {
    encoding: "utf-8",
  });
  if (git.status === 0 && git.stdout.trim()) {
    versionCache = git.stdout.trim();
    return versionCache;
  }
  versionCache = "unknown";
  return versionCache;
};
