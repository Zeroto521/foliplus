/**
 * import-aggregate — at most one import declaration per (source, kind)
 * bucket. Buckets:
 *   - "type"  — `import type { A }` (top-level `type` modifier)
 *   - "value" — every non-namespace form: `import { … }`, `import Default`,
 *               `import Default, { … }`. Inline `type X` specifiers inside
 *               named imports are allowed.
 *
 * Namespace imports (`import * as X`) are skipped entirely — they are
 * free, not counted toward either bucket. Two reasons:
 *
 *   - Combining `* as` with named specifiers in the same declaration is
 *     invalid TS (`import * as X, { … }` does not parse), so `* as`
 *     always gets its own declaration. Grouping it into the value
 *     bucket would false-positive on a legitimate same-source ns+named
 *     pair.
 *   - Grouping it into its own "namespace" bucket to enforce "one per
 *     source" is a no-op here: zero files in the tree have two
 *     `import * as …` declarations from the same source.
 *
 * Namespace + named from the same source is allowed. It's redundant at
 * runtime (`* as X` already exposes the named export) and defeats
 * tree-shaking, so we prefer collapsing such pairs to a single named
 * import whenever possible — but the one place that keeps the pair is
 * `test/js/core/leafletAdapter.test.ts`, which reads
 * `Object.keys(adapter)` to assert the module's public shape. That
 * introspection cannot be reproduced from the named imports alone, so
 * the pair is legitimate there.
 *
 * The project's canonical split — `import type { A }` + `import { B }`
 * from the same module — is in different buckets and passes.
 *
 * The core `no-duplicate-imports` folds type and value into a single
 * bucket and flags that split. `eslint-plugin-import`'s `no-duplicates`
 * accepts the clean split when `prefer-inline: false`, but collapses
 * `import type { A }` + `import { type X, B }` (inline `type` specifier
 * alongside value specifiers) — which the project actually uses
 * (`LayerIntentStore.ts` `./intent.js`) — with no option to loosen it.
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
        "One import declaration per module and per bucket (type / value). Namespace imports are free.",
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

    return {
      ImportDeclaration(node) {
        // Namespace imports (`import * as X`) are free — skip them.
        const isNamespace = node.specifiers.some(
          s => s.type === "ImportNamespaceSpecifier",
        );
        if (isNamespace) return;

        const source = node.source.value;
        const kind = node.importKind === "type" ? "type" : "value";
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
