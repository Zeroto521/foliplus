// script/build/registry-assert — the generated shared registry must publish every spec components import
/**
 * scan-registry.mjs can exit 0 after writing a partial or empty registry (a
 * scan that silently loses a spec, a generator regression, a truncated write).
 * The build would then bundle components whose shim resolves
 * `window.foliplus.core.<x>` to undefined — the failure surfaces only in the
 * browser at runtime. This module asserts the generated TEXT instead: the
 * three namespaces exist, and every spec the components import has its import
 * line. A missing namespace or spec is reported by name, and build.mjs exits
 * non-zero before esbuild runs.
 *
 * core/component, core/hint and core/mode are registered manually in
 * runtime/index.ts (the generated registry deliberately skips them), so they
 * are the only specs exempt from the import-coverage rule.
 */
/** Namespaces every generated registry must publish, whatever the scan found. */
const REQUIRED_NAMESPACES = [
  "window.foliplus.core",
  "window.foliplus.platform",
  "window.foliplus.ui",
];

/** Core modules registered by hand in runtime/index.ts, never generated. */
const MANUAL_CORE = new Set(["core/component", "core/hint", "core/mode"]);

/** The import specifiers the generator can use for one scanned spec key. */
const importCandidates = spec => {
  if (spec === "ui") return ["#ui/index.js"];
  if (spec === "foliplus/BaseControl") return ["#foliplus/BaseControl.js"];
  const coreSub = spec.match(/^core\/([^/]+)(?:\/(.+))?$/);
  if (coreSub) {
    return [`#core/${coreSub[1]}/index.js`, `#core/${coreSub[1]}.js`];
  }
  const slash = spec.indexOf("/");
  if (slash === -1) return [];
  const tier = spec.slice(0, slash);
  const rest = spec.slice(slash + 1);
  return [`#${tier}/${rest}.js`, `#${tier}/${rest}/index.js`];
};

/** Every completeness problem in one generated registry text; empty = complete. */
const registryProblems = (text, usedExports) => {
  const problems = [];
  for (const namespace of REQUIRED_NAMESPACES) {
    if (!text.includes(namespace)) {
      problems.push(`missing namespace ${namespace}`);
    }
  }
  for (const [spec, names] of Object.entries(usedExports)) {
    if (names.length === 0 || MANUAL_CORE.has(spec)) continue;
    const candidates = importCandidates(spec);
    if (candidates.length === 0) {
      problems.push(`unrecognised spec ${spec} (${names.length} exports)`);
    } else if (!candidates.some(specifier => text.includes(specifier))) {
      problems.push(
        `spec ${spec} (${names.length} exports) has no import line (expected ${candidates.join(" or ")})`,
      );
    }
  }
  return problems;
};

export { MANUAL_CORE, REQUIRED_NAMESPACES, importCandidates, registryProblems };
