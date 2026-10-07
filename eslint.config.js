// ESLint config for the foliplus JS/TS runtime and test suite — pass 1,
// the non-type-aware quality rules. This file is the `base` spread into
// eslint.config.type.js; `npm run lint` and `npm run typecheck` both go
// through that single config.
//
// The Promise-discipline and other type-aware rules live in
// eslint.config.type.js and are run by `npm run typecheck` (and `npm run lint`,
// which now uses the same config). Keeping them out here means this config
// doesn't load a tsconfig project program — it can be imported without the
// full typecheck setup. This file still imports typescript-eslint (line 24)
// to spread `...tseslint.configs.recommended`, which provides the TS parser
// and `@typescript-eslint` plugin registration; those are cheap to import
// and don't require a type program.
//
// Division of labor with prettier (see .prettierrc.cjs):
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

// `import/no-cycle` runs with the syntax-level pass, not the type-aware one.
// It needs a TS-capable resolver (the repo's `.js` extension spec resolves to
// `.ts` files, and `#core/*`-style aliases rely on tsconfig `paths`) — the
// typescript resolver is the only one that handles both. See the exemption
// block at the bottom for the files still flagged by the rule.
const importPlugin = (await import("eslint-plugin-import")).default;

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
    plugins: { import: importPlugin },
    settings: {
      // eslint-plugin-import's default `validExtensions` is
      // `['.js', '.mjs', '.cjs']`; without these the builder silently drops
      // every `.ts` import it can't parse, and `no-cycle` never fires.
      "import/extensions": [".js", ".mjs", ".cjs", ".ts", ".tsx"],
      "import/resolver": {
        typescript: { project: "./tsconfig.json" },
      },
    },
    rules: {
      // Circular dependencies are almost always a smell — they complicate
      // initialization order and make tree-shaking / module bundling fragile.
      // `import/no-cycle` runs here (syntax-level, no type program) rather
      // than in eslint.config.type.js. It ignores type-only imports by
      // default, so a `import type { X } from "./sibling"` edge never trips
      // it — that only matters when the value edge itself is what closes the
      // cycle.
      //
      // File-level exemptions at the bottom of this file (SearchControl
      // history/search bidirectional). These are pre-existing value cycles
      // that were already in the shipped codebase; they belong in their own
      // cleanup PRs, not here.
      "import/no-cycle": ["error", { maxDepth: 10 }],

      // Layered dependency direction — the runtime tree is a strict DAG:
      //   common/  (bottom: DOM/storage/format utilities)
      //     ↑
      //   core/    (domain: layer, geocode, event, leaflet adapter, mode)
      //     ↑
      //   {Component}Control/   (LayerControl, SearchControl, MeasureControl, …)
      //
      // `#foliplus/config-schema.js` and `#foliplus/BaseControl.js` are
      // top-level shared modules at the same layer as common/ and core/
      // (imported by both); they are intentionally NOT in these targets —
      // only cross-layer upward edges are forbidden. Two zones, no
      // pre-existing violations in the tree (verified: common→core 0,
      // core→component 0).
      //
      // Semantic note (the names invert from intuition): `target` matches
      // against the *importing file* (the source of the edge), `from`
      // matches against the *imported path* (the destination). So this
      // reads as "files matching target are forbidden from importing
      // anything matching from".
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              // common/ is the bottom layer — never imports upward.
              target: ["./foliplus/js/common/**"],
              from: [
                "./foliplus/js/core/**",
                "./foliplus/js/LayerControl/**",
                "./foliplus/js/SearchControl/**",
                "./foliplus/js/MeasureControl/**",
                "./foliplus/js/LocateControl/**",
                "./foliplus/js/ExportControl/**",
                "./foliplus/js/FullscreenControl/**",
                "./foliplus/js/HeatmapControl/**",
                "./foliplus/js/ScaleControl/**",
              ],
              message:
                "common/ is the bottom layer: no upward deps to core/ or component dirs.",
            },
            {
              // core/ may reach common/ and the top-level shared modules,
              // but never reaches down into a component's implementation.
              target: ["./foliplus/js/core/**"],
              from: [
                "./foliplus/js/LayerControl/**",
                "./foliplus/js/SearchControl/**",
                "./foliplus/js/MeasureControl/**",
                "./foliplus/js/LocateControl/**",
                "./foliplus/js/ExportControl/**",
                "./foliplus/js/FullscreenControl/**",
                "./foliplus/js/HeatmapControl/**",
                "./foliplus/js/ScaleControl/**",
              ],
              message:
                "core/ cannot depend on component implementations (LayerControl, SearchControl, …).",
            },
          ],
        },
      ],

      // Dead-export detector lives in eslint.config.type.js (needs the
      // TS program for `ignoreUnusedTypeExports` to work). See the type
      // config for the rule's `ignoreExports` patterns and rationale.

      // One import declaration per module — the project's import
      // convention. `import type { A }` + `import { B }` from the same
      // module must merge into `import { B, type A }` (inline type).
      // Import ordering stays prettier's job.
      "no-duplicate-imports": "error",

      // Types in a value import get the `type` keyword inline (`import { type A, B }`)
      // so a type-only reference is never mistaken for a runtime binding.
      // `inline-type-imports` keeps one declaration per source — no-duplicate-imports
      // would reject a split `import { B }` + `import type { A }` pair from the
      // same module. `disallowTypeAnnotations: false` leaves the existing
      // `import("x").Y` type queries alone (a separate stylistic preference,
      // not this rule's job).
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports", disallowTypeAnnotations: false },
      ],

      // A constructor whose body is only `super()` is dead code — the class
      // inherits its parent's constructor unchanged. Pure future-guard
      // (#620 removed one; this prevents a regression).
      "@typescript-eslint/no-useless-constructor": "error",

      // `a && a.b` collapses to `a?.b` — the optional chain is the idiom
      // and the guard it replaces is invisible in the AST. Type-aware
      // (needs the parser program); lives in eslint.config.type.js.
      // See the type config for `@typescript-eslint/prefer-optional-chain`.

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

      // `allowEmptyCatch` because test cleanup runs `rmSync` / `unlinkSync`
      // in a best-effort pattern (`try { fs.rmSync(x) } catch {}`) — the
      // error is expected and ignored by design. Empty `if` / `for` / `try`
      // blocks still error, which is the intent (silent bugs).
      "no-empty": ["error", { allowEmptyCatch: true }],

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

      // Variable shadowing is a common source of subtle bugs. `allow: ["_","e"]`
      // permits the project's catch-parameter idiom (`catch (e)`) and the
      // underscore-prefix convention for deliberate placeholders. `ignoreTypeValueShadow`
      // allows a type declaration to shadow a value of the same name (the TS
      // pattern `class Foo {}` + `type Foo = …` is legal and used for
      // constructor-vs-instance type splitting).
      "@typescript-eslint/no-shadow": [
        "error",
        { allow: ["_", "e"], ignoreTypeValueShadow: true },
      ],
    },
  },

  // ── `import/no-cycle` is enabled globally ──
  // Both pre-existing value cycles have been broken:
  //   - LayerControl/ui/listPanel/rowView ↔ projection (broken in #640)
  //   - SearchControl/logic/history ↔ search (broken in this PR via panel.ts)
  // The rule now catches *any* new cycle outright.

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
      // Test mocks shadow source variables by design (vi.fn() as typeof L,
      // fixture objects reusing production names). no-shadow adds no value
      // in a codebase that is 100% mock-driven.
      "@typescript-eslint/no-shadow": "off",
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

      // Relative path depth: one level (`./`, `../`) is fine; two+ (`../../`
      // and above) means the caller should reach for an alias (`#common/…`,
      // `#core/…`, `#foliplus/…`, `#script/…`). Deeper relatives mean the
      // module tree is out of shape — the alias is the source of truth for
      // where a shared module lives. Source-only: tests reach up to
      // `test/js/fixture.js` (2 levels) in six places, and adding a `#test`
      // alias for that would be an infrastructure change with no consumer
      // outside those test files.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../*"],
              message:
                "Use a path alias (#common/…, #core/…, #foliplus/…, #script/…) instead of walking up two+ levels.",
            },
          ],
        },
      ],
    },
  },

];
