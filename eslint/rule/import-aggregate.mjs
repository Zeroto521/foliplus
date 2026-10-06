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
 * A same-source namespace + named pair is not itself an aggregation
 * failure (namespace and value are different buckets), but it is
 * redundant at runtime (`* as X` already exposes the named export) and
 * defeats tree-shaking, so we prefer collapsing the pair to a single
 * named import whenever the namespace form isn't needed for API-surface
 * introspection (see the sole such case: `test/js/core/leafletAdapter.test.ts`,
 * which reads `Object.keys(adapter)` to assert the module's public shape).
 *
 * The core `no-duplicate-imports` folds all three buckets into one and
 * flags the split form this project wants. `eslint-plugin-import`'s
 * `no-duplicates` accepts the clean `import type { A }` + `import { B }`
 * split when `prefer-inline: false`, but collapses `import type { A }`
 * + `import { type X, B }` (inline type specifier alongside value
 * specifiers) — which the project actually uses (`LayerIntentStore.ts`
 * `./intent.js`) — with no option to loosen it.
 *
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
