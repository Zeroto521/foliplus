// ESLint config for the foliplus JS/TS runtime and test suite — pass 1,
// the non-type-aware quality rules. Run it with `npm run lint`.
//
// The Promise-discipline rules live in eslint.config.type.js and are run by
// `npm run typecheck`. Keeping them out here means this config imports no
// typescript package at all, so it reports the same result with or without
// node_modules.
//
// Division of labour with prettier (see .prettierrc.cjs):
//   - prettier owns typography (indent, width, quotes, import order) and
//     preserves existing blank lines but never adds or removes them.
//   - eslint owns code quality (eqeqeq, no-implicit-coercion, ...) and one
//     thing prettier cannot express: blank lines before function/class
//     definitions (Python E302/E305 equivalent).
//
// The blank-line rule is deliberately scoped to function/class definitions
// only. Mainstream configs (Airbnb, Google, Microsoft's FluidFramework,
// prettier's own repo) leave padding-line-between-statements off entirely;
// jellyfin-vue groups by block/category. None of them pad every expression
// statement — that is what the old `next: "expression"` rule did and it
// inflated the tree with blank lines around every `this.method()` call.
//
// @see https://eslint.org/docs/latest/use/configure/
import tseslint from "typescript-eslint";

export default [
  // Guard against a bare `eslint .`, which would sweep .venv, doc/, and
  // the build output. The lint script's globs already avoid those, so
  // these only matter for an ad-hoc invocation. test/js/browser/** uses CDN
  // globals (Leaflet, turf) rather than imports.
  {
    ignores: [
      "foliplus/dist/**",
      "node_modules/**",
      "test/js/browser/**",
      "doc/**",
      "script/sonda/**",
    ],
  },

  // Base TS rules (no type info — covers all TS/JS files).
  ...tseslint.configs.recommended,

  // ── Quality + structural rules prettier cannot express ──
  {
    files: [
      "foliplus/js/**/*.ts",
      "test/js/**/*.ts",
      "script/**/*.mjs",
      "script/**/*.cjs",
      "script/**/*.js",
    ],
    rules: {
      // Python E302 / E305: blank line before function / class definitions.
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "function" },
        { blankLine: "always", prev: "*", next: "class" },
      ],

      // ── Quality rules (mirroring prettier's own repo) ──
      // `smart` keeps the idiomatic `x == null` null-check (matches both
      // null and undefined) while banning loose equality elsewhere — the
      // project uses `== null` as a deliberate nullish guard.
      eqeqeq: ["error", "smart"],
      // `multi-line` keeps braces required where omission hurts (multi-line
      // bodies hide nesting) but allows the project's `if (x) return;` /
      // `if (x) foo();` one-liners, which are the dominant idiom. Default
      // `"error"` flagged 91 of them.
      curly: ["error", "multi-line"],
      "no-else-return": "error",
      // `!!x` is the project's idiom for boolean narrowing inside
      // short-circuits (`!!opts?.pane && panes.includes(opts.pane)`) —
      // the tsc-narrowing form that `Boolean(x) && ...` cannot express.
      "no-implicit-coercion": ["error", { allow: ["!!"] }],
      "no-unneeded-ternary": "error",
      "no-useless-return": "error",
      "object-shorthand": ["error", "always"],
      "one-var": ["error", "never"],
      "prefer-const": "error",

      // Zero-cost guards: every one of these flagged nothing across the tree,
      // so they are pure future-proofing rather than churn. The one exception
      // is no-irregular-whitespace, whose skipRegExps is load-bearing —
      // bundle-size-check.mjs legitimately matches the BOM (﻿) that
      // esbuild prepends to every bundle, and that is a real character, not
      // stray whitespace.
      "no-var": "error",
      "no-debugger": "error",
      "no-alert": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-unreachable": "error",
      "no-throw-literal": "error",
      "no-self-compare": "error",
      "no-multi-str": "error",
      "no-import-assign": "error",
      "no-case-declarations": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "use-isnan": "error",
      "valid-typeof": "error",
      "no-irregular-whitespace": ["error", { skipRegExps: true }],
      // Project convention uses `a && b()` and `cond ? x() : y()` as
      // statement expressions (reindexAfterMove, add/removeLayer branches),
      // so allow short-circuit and ternary — same option set as prettier's
      // own eslint config.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
      // No `allow` entry: a signature-shaped allowance (e.g. arrow functions)
      // would also admit genuinely dead no-ops. Deliberate stubs — lifecycle
      // hooks, mutable slot defaults, teardown no-ops — opt out line by line
      // with a why-comment, which keeps each one an explicit decision.
      "@typescript-eslint/no-empty-function": "error",

      // Dead imports and variables are a bug smell in production code; we
      // catch them here rather than letting them rot. `_` prefix exempts
      // deliberate placeholders — mock/test signatures that must accept a
      // value they ignore (`_map`, `_opts`, `_from`, …) fall under the same
      // convention as unused local vars, and unused `catch (e)` bindings are
      // handled by the bare-`catch` form, not by prefixing.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" },
      ],
      "no-unused-vars": "off",

      // Heavy-mock test suite and Leaflet interop make `any` idiomatic here.
      // tsconfig's noImplicitAny still catches implicit ones.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Test scripts exercise the CJS build tooling via require(); the source
  // tree and `script/` never do.
  //
  // no-empty-function is also off here: 166 hits, every one a mock (Canvas2D,
  // MutationObserver, LayerRegistry.eachLayer, vi.fn() stand-ins) where the
  // empty body *is* the stub — a full `allow` list would be equivalent to off
  // and suppressing them line by line would add 166 directives. Runtime and
  // `script/` keep the rule at full strength.
  {
    files: ["test/js/**/*.{js,ts}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },

  // ── Ambient globals: `declare var` is the canonical form here ──
  {
    files: ["test/js/globals.d.ts"],
    rules: { "no-var": "off" },
  },

  // ── Runtime only: no bare console ──
  // foliplus/js logs through createLogger(). Excluded on
  // purpose: script/* is build tooling whose entire output *is* console.log,
  // and test/js talks to the console through its mocks.
  //
  // warn/error stay allowed: createLogger() itself logs through
  // console.error / console.warn, so banning them would also ban the
  // sanctioned logging path. The leak this catches is a bare
  // console.log / console.info in runtime code.
  {
    files: ["foliplus/js/**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },

  // Module surface style (source only — tests may use function declarations).
  // script/ joins here too: its own inline exports were the reason this rule
  // had a source-only scope that the build tooling was exempted from.
  {
    files: ["foliplus/js/**/*.ts", "script/**/*.{js,cjs,mjs}"],
    rules: {
      // `const fn = () => {}` only — no `export function` / `function foo()`.
      "func-style": ["error", "expression", { allowArrowFunctions: true }],
      // Catch `fn( arg )` — prettier usually fixes this, but keep an explicit gate.
      "space-in-parens": ["error", "never"],
      // One `export { … }` block at the bottom of the file — no inline export.
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExportNamedDeclaration[declaration]",
          message:
            "Use a single export { … } block at the bottom of the file instead of inline export.",
        },
      ],
    },
  },
];
