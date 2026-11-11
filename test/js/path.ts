import { resolve } from "node:path";
import { repoRoot } from "#script/build-path.mjs";

/**
 * Single source for repo-relative path resolution in the test suite.
 *
 * Before this module, tests each spelled their own parent-dir chain
 * (resolve(__dirname, up4) or the import.meta equivalent) to reach
 * the repo root, and the chain depth drifted with the file's nesting. This
 * module reuses the same walk script/build-path.mjs uses for its alias tables
 * (repoRoot), so the root is anchored to package.json, not to a fixed parent
 * count. Tests import ROOT or repoPath through the #test alias, so no test
 * file needs a parent-dir chain at all.
 */
export const ROOT: string = repoRoot(import.meta.url);

/** Resolve a repo-relative specifier against the repository root. */
export const repoPath = (...segments: string[]): string => resolve(ROOT, ...segments);
