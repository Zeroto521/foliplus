/**
 * Stylesheet merge helpers for the build.
 *
 * Two consumers share this contract:
 *
 * - `foliplus/css/common/` — every module declares its dependencies with a
 *   leading `@import "name.css";` statement. The build resolves that graph to
 *   order the merged bundle (dependencies first) and strips the statements
 *   from the output, which must ship flat.
 * - `foliplus/css/{Component}/` — a split component stylesheet: `index.css`
 *   is the entry, importing its modules in cascade order. The entry's import
 *   order IS the rule order (same specificity → later wins), so it must be
 *   preserved verbatim rather than re-derived topologically.
 *
 * This module is the pure half of that pipeline — no fs, no argv, no
 * process.exit — so it is unit-testable and reusable by any consumer that
 * wants the same contract.
 */

/** Match the bare quoted form of a CSS @import: `@import "name.css";`. */
const IMPORT_RE = /^@import\s+["']([^"']+)["']\s*;/;

/** Normalise an import target: `./focus.css` → `focus.css` (bare name). */
const normalizeImport = name => name.replace(/^\.\//, "");

/** Collect the filenames this source imports, in declaration order. */
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
 * Order a set of stylesheet sources by their `@import` dependencies.
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
 * @param {Map<string, string>} sources filename → source text (bare names)
 * @param {string} label directory name for error messages, e.g. "common"
 * @returns {string[]} filenames in topological (dependency-first) order
 * @throws {Error} on self-import, unresolved import, or an import cycle
 */
const orderCss = (sources, label) => {
  const files = [...sources.keys()];
  const depsOf = new Map(
    files.map(f => [f, parseImports(sources.get(f)).map(normalizeImport)]),
  );

  for (const [file, deps] of depsOf) {
    for (const dep of deps) {
      if (dep === file) {
        throw new Error(`build: css/${label}/${file} imports itself`);
      }
      if (!sources.has(dep)) {
        throw new Error(
          `build: css/${label}/${file} imports "${dep}" which is not in css/${label}/`,
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
        `build: css/${label}/ import cycle: ${[...stack, file].join(" → ")}`,
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

/**
 * Merge a dependency-ordered directory of stylesheet sources into one flat
 * stylesheet (the `css/common/` contract).
 *
 * @param {Map<string, string>} sources filename → source text (bare names)
 * @param {string} label directory name for error messages, e.g. "common"
 * @returns {string} the merged stylesheet, imports stripped
 */
const mergeCss = (sources, label) =>
  orderCss(sources, label)
    .map(f => stripImports(sources.get(f)))
    .join("\n");

/**
 * Expand a component entry (`index.css`) into the merged stylesheet.
 *
 * The entry's `@import` statements are replaced, in place, by the imported
 * module's content (imports stripped). The entry's own rules — if any — keep
 * their position relative to the modules, and modules keep their declaration
 * order: for a component the import order IS the cascade order, unlike
 * `css/common/` where dependencies drive a topological sort.
 *
 * @param {Map<string, string>} sources filename → source text (bare names)
 * @param {string} entry name of the entry file, e.g. "index.css"
 * @param {string} label directory name for error messages, e.g. "LayerControl"
 * @returns {string} the merged stylesheet, imports stripped
 */
const expandEntry = (sources, entry, label) => {
  if (!sources.has(entry)) {
    throw new Error(`build: css/${label}/ has no entry "${entry}"`);
  }
  const imported = new Set([entry]);
  const result = sources
    .get(entry)
    .split("\n")
    .map(line => {
      const m = line.trim().match(IMPORT_RE);
      if (!m) return line;
      const target = normalizeImport(m[1]);
      if (!sources.has(target)) {
        throw new Error(
          `build: css/${label}/${entry} imports "${target}" which is not in css/${label}/`,
        );
      }
      imported.add(target);
      return stripImports(sources.get(target));
    })
    .join("\n");

  // A module sitting in the directory but never imported would silently
  // vanish from the bundle — the same drift `orderCss` cannot have (it walks
  // every source), so flag it here instead of shipping a half stylesheet.
  const orphan = [...sources.keys()].filter(f => !imported.has(f));
  if (orphan.length) {
    throw new Error(
      `build: css/${label}/ ${orphan.join(", ")} never imported by ${entry}`,
    );
  }
  return result;
};

export { expandEntry, mergeCss, normalizeImport, orderCss, parseImports, stripImports };
