/**
 * Resolve the foliplus version for build banners.
 *
 * Uses `git describe` (tag + distance + commit) — identical in local dev and
 * CI, so the version string never differs between environments. No `--dirty`:
 * a dirty tree must not change the version, or the banner (and thus bundle
 * size) would drift whenever a developer builds with uncommitted changes.
 */
import { spawnSync } from "child_process";

let versionCache = null;

export const resolveVersion = () => {
  if (versionCache) return versionCache;

  const git = spawnSync("git", ["describe", "--tags", "--always"], {
    encoding: "utf-8",
  });
  if (git.status === 0 && git.stdout.trim()) {
    versionCache = git.stdout.trim();
    return versionCache;
  }

  versionCache = "unknown";
  return versionCache;
};
