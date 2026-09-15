/**
 * Shared-stylesheet merge helpers for the build.
 *
 * Every module in `foliplus/css/common/` declares its dependencies with a
 * leading `@import "name.css";` statement. The build resolves that graph to
 * order the merged bundle (dependencies first) and strips the statements from
 * the output, which must ship flat. This module is the pure half of that
 * pipeline — no fs, no argv, no process.exit — so it is unit-testable and
 * reusable by any consumer that wants the same contract.
 */

/** Match the bare quoted form of a CSS @import: `@import "name.css";`. */
const IMPORT_RE = /^@import\s+["']([^"']+)["']\s*;/;

/** Collect the bare filenames this source imports, in declaration order. */
const parseImports = source =>
  source
    .split("\n")
    .map(line => line.trim().match(IMPORT_RE)?.[1])
    .filter(Boolean);

/** Drop `@import` statements from a source; the merged bundle must not carry them. */
const stripImports = source =>
  source
    .split("\n")
    .filter(line => !line.trim().match(IMPORT_RE))
    .join("\n");

/**
 * Order a set of shared stylesheet sources by their `@import` dependencies.
 *
 * Returns filenames in topological order: a module always comes after every
 * module it imports (transitively), so `token.css` — imported by everyone —
 * lands first. Sibling modules that do not import each other keep their
 * insertion order, which the caller controls; `build.mjs` feeds keys sorted
 * by filename so the output is deterministic without a maintained manifest.
 *
 * Guards replace the old folder-vs-manifest drift check, which caught two
 * silent failure modes: an unlisted file dropped from the bundle, and an
 * entry with no file omitted. Discovery makes the first impossible by
 * construction; the second becomes a loud error here — a module importing a
 * name that is not in the set fails instead of silently dropping the import.
 * Statements that do not match `IMPORT_RE` (e.g. `@import url(...)`) are left
 * in the output, where esbuild fails loudly on the unresolved import.
 *
 * @param {Map<string, string>} sources filename → source text
 * @returns {string[]} filenames in topological (dependency-first) order
 * @throws {Error} on self-import, unresolved import, or an import cycle
 */
const orderCommonCss = sources => {
  const files = [...sources.keys()];
  const depsOf = new Map(files.map(f => [f, parseImports(sources.get(f))]));

  for (const [file, deps] of depsOf) {
    for (const dep of deps) {
      if (dep === file) {
        throw new Error(`build: css/common/${file} imports itself`);
      }
      if (!sources.has(dep)) {
        throw new Error(
          `build: css/common/${file} imports "${dep}" which is not in css/common/`,
        );
      }
    }
  }

  // DFS topological sort, dependencies first; insertion order is the
  // tie-break for siblings. Cycle detection reuses the visiting marker.
  const ordered = [];
  const state = new Map(); // 0 = visiting, 1 = done
  const visit = (file, stack = []) => {
    const s = state.get(file);
    if (s === 1) return;
    if (s === 0) {
      throw new Error(
        `build: css/common/ import cycle: ${[...stack, file].join(" → ")}`,
      );
    }
    state.set(file, 0);
    for (const dep of depsOf.get(file)) visit(dep, [...stack, file]);
    state.set(file, 1);
    ordered.push(file);
  };
  for (const file of files) visit(file);

  return ordered;
};

export { orderCommonCss, parseImports, stripImports };
