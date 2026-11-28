// script/build/source-hash — one content hash of the JS/CSS sources, so --verify can tell a rebuilt dist from a stale one
/**
 * Why a content hash: dist/manifest.json used to record only the artifact
 * NAMES, so `--verify` proved the tree existed, never that it was built from
 * the sources in front of it. A source edit without a rebuild therefore passed
 * the gate, and the Python tests rendered the previous bundle.
 *
 * Algorithm: walk foliplus/js and foliplus/css, skip build outputs (.build,
 * dist, node_modules) and sourcemaps, sort by POSIX relative path, then sha256
 * over `path \0 content \0` in that order. The path is part of the digest, so
 * renaming a module changes the hash even when no content byte does, and the
 * sorted order makes the result independent of directory enumeration order.
 *
 * Excludes dist/ because the manifest itself lives there (a hash that covered
 * its own output could never stabilize), and .build/ because those files are
 * regenerated on every build (the shared registry is generated from the sources
 * the hash already covers).
 *
 * Imports only fs/crypto on purpose: the gate and its tests must never load
 * esbuild just to read a hash.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, resolve, sep } from "path";

/** The two source trees whose content defines a build. */
const SOURCE_ROOTS = ["foliplus/js", "foliplus/css"];

/** Directories that are build outputs, never inputs. */
const EXCLUDED_DIRS = new Set([".build", "dist", "node_modules"]);

/** Sourcemaps are build side products, not source. */
const EXCLUDED_FILE = /\.map$/;

/** Every source file under `root`, as repo-relative POSIX paths, sorted. */
const sourceFiles = root => {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      const path = join(dir, entry.name);
      const rel = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path, rel);
      else if (!EXCLUDED_FILE.test(entry.name)) files.push(rel);
    }
  };
  for (const prefix of SOURCE_ROOTS) {
    const dir = resolve(root, prefix);
    if (existsSync(dir)) walk(dir, prefix);
  }
  return files.sort();
};

/** The content hash of a source tree, lowercase hex sha256. */
const computeSourceHash = root => {
  const hash = createHash("sha256");
  for (const rel of sourceFiles(root)) {
    hash.update(rel);
    hash.update("\0");
    hash.update(readFileSync(resolve(root, rel.split("/").join(sep))));
    hash.update("\0");
  }
  return hash.digest("hex");
};

export { EXCLUDED_DIRS, EXCLUDED_FILE, SOURCE_ROOTS, computeSourceHash, sourceFiles };
