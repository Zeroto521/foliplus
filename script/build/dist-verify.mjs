// script/build/dist-verify — --verify's gate: dist/ is complete AND was built from the current sources
/**
 * Two failure classes, one module:
 *
 *   1. completeness — every artifact dist/manifest.json lists exists. The
 *      expected list comes from that manifest (written by the build), not from
 *      re-deriving component names here: the gate must check the build it is
 *      checking, and the Python wheel test and build.test.ts read the same file.
 *   2. freshness — manifest.sourceHash must equal a hash recomputed from the
 *      source tree now, and manifest.buildVersion must match the version this
 *      checkout reports. A mismatch means the source changed after the last
 *      build, so the dist is stale and the tests would read the old bundle.
 *
 * Pure: returns a list of human-readable problems (empty = pass); build.mjs
 * prints them and exits. Keeping it out of build.mjs is what lets the stale
 * scenarios be unit-tested against temp roots instead of the real tree.
 */
import { computeSourceHash } from "./source-hash.mjs";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/** Both halves of every artifact a component name expands to. */
const artifactNames = name => [`foliplus-${name}.min.js`, `foliplus-${name}.min.css`];

/** Every problem with `root`'s dist tree; empty means "complete and fresh".
 *  @param {{ root: string, buildVersion?: string | null }} options
 *  @returns {string[]} */
const verifyDist = ({ root, buildVersion = null }) => {
  const distDir = resolve(root, "foliplus/dist");
  const manifestPath = resolve(distDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return ["No dist/manifest.json — run `npm run build` first"];
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return [
      "dist/manifest.json is not valid JSON — the last build was interrupted; run `npm run build`",
    ];
  }
  if (!Array.isArray(manifest.artifacts)) {
    return ["dist/manifest.json has no artifacts array — rebuild (`npm run build`)"];
  }

  const problems = [];
  const expected = manifest.artifacts.flatMap(artifactNames);
  const missing = expected.filter(file => !existsSync(resolve(distDir, file)));
  if (missing.length) {
    problems.push(
      `Missing artifacts: ${missing.join(", ")} — run \`npm run build\` first`,
    );
  }

  if (!manifest.sourceHash) {
    problems.push(
      "dist/manifest.json has no sourceHash — it was written by an older build script; rebuild (`npm run build`) so stale detection works",
    );
  } else {
    const current = computeSourceHash(root);
    if (current !== manifest.sourceHash) {
      problems.push(
        `stale dist: manifest sourceHash ${manifest.sourceHash} but the current source tree hashes to ${current} — the source changed after the last build; run \`npm run build\` (or \`npm run build:dev\`)`,
      );
    }
  }

  if (buildVersion) {
    if (!manifest.buildVersion) {
      problems.push(
        "dist/manifest.json has no buildVersion — rebuild (`npm run build`)",
      );
    } else if (manifest.buildVersion !== buildVersion) {
      problems.push(
        `stale dist: built as ${manifest.buildVersion}, this checkout is ${buildVersion} — rebuild (\`npm run build\`)`,
      );
    }
  }

  return problems;
};

export { artifactNames, verifyDist };
