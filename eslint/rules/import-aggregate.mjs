/**
 * import-aggregate — at most one import declaration per (source, kind)
 * bucket. Buckets:
 *   - "type"      — `import type { A }` (top-level `type` modifier)
 *   - "namespace" — `import * as X` (TS forbids combining `* as` with
 *                   named specifiers in the same declaration, so this
 *                   gets its own bucket instead of merging into value)
 *   - "value"     — every other form (`import { … }`, `import Default`,
 *                   `import Default, { … }`); inline `type X` specifiers
 *                   are allowed inside
 *
 * `import type { A }` + `import { B }` from the same module — the
 * project's canonical split — is in different buckets and passes.
 *
 * The core `no-duplicate-imports` folds all three buckets into one and
 * flags the split form this project wants; this rule replaces it here.
 * Import ordering is prettier's job; this rule only enforces aggregation.
 *
 * @see eslint.config.js — where this is wired in.
 */

export const importAggregate = {
  meta: {
    type: "problem",
    docs: {
      description:
        "One import declaration per module and per bucket (type / namespace / value).",
      recommended: false,
    },
    schema: [],
    messages: {
      merge:
        "Merge this import into the earlier {{kind}} import from the same module '{{source}}'.",
    },
  },
  create(context) {
    const bySource = new Map();

    const bucket = node => {
      if (node.importKind === "type") return "type";
      if (node.specifiers.some(s => s.type === "ImportNamespaceSpecifier")) {
        return "namespace";
      }
      return "value";
    };

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        const kind = bucket(node);
        const buckets = bySource.get(source) ?? new Map();
        bySource.set(source, buckets);
        const list = buckets.get(kind) ?? [];
        buckets.set(kind, list);
        list.push(node);
        if (list.length > 1) {
          context.report({
            node,
            messageId: "merge",
            data: { source, kind },
          });
        }
      },
    };
  },
};
