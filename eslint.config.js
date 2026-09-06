// ESLint config for the foliplus JS/TS runtime and test suite.
//
// Division of labour with prettier (see .prettierrc.cjs):
//   - prettier owns typography (indent, width, quotes, import order) and
//     preserves existing blank lines but never adds or removes them.
//   - eslint owns code quality (eqeqeq, no-implicit-coercion, ...) and two
//     things prettier cannot express: blank lines before function/class
//     definitions (Python E302/E305 equivalent) and Promise discipline.
//
// The blank-line rule is deliberately scoped to function/class definitions
// only. Mainstream configs (Airbnb, Google, Microsoft's FluidFramework,
// prettier's own repo) leave padding-line-between-statements off entirely;
// jellyfin-vue groups by block/category. None of them pad every expression
// statement — that is what the old `next: "expression"` rule did and it
// inflated the tree with blank lines around every `this.method()` call.
//
// Two passes over the TS sources:
//   1. Non-type-aware rules — fast, AST only (covers all files).
//   2. Type-aware rules (Promise discipline) — slower, needs the tsconfig
//      program (only covers foliplus/js; test/js is not in tsconfig include,
//      see tsconfig.json comment). Skipped when the project-local typescript
//      is absent — that is the pre-commit.ci isolated env, whose node_modules
//      live under NODE_PATH, not next to package.json. `npm run lint` runs
//      the full set with the program available.
import eslintConfigPrettier from "eslint-config-prettier";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));
const skipTypecheck = !existsSync(join(root, "node_modules", "typescript"));

export default [
  // Build output, vendored deps, browser tests (use CDN globals)
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

  // ── Pass 1: quality + structural rules prettier cannot express ──
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
      curly: "error",
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
      // Project convention uses `a && b()` and `cond ? x() : y()` as
      // statement expressions (reindexAfterMove, add/removeLayer branches),
      // so allow short-circuit and ternary — same option set as prettier's
      // own eslint config.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      // tsc --noEmit already checks unused vars (noUnusedLocals)
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",

      // Heavy-mock test suite and Leaflet interop make `any` idiomatic here.
      // tsconfig's noImplicitAny still catches implicit ones.
      "@typescript-eslint/no-explicit-any": "off",

      // Test scripts exercise the CJS build tooling via require().
      "@typescript-eslint/no-require-imports": "off",
    },
  },

  // ── Ambient globals: `declare var` is the canonical form here ──
  {
    files: ["test/js/globals.d.ts"],
    rules: { "no-var": "off" },
  },

  // ── Pass 2: Promise discipline (needs type info) ──
  ...(skipTypecheck
    ? []
    : [
        {
          files: ["foliplus/js/**/*.ts"],
          rules: {
            // Unhandled Promise (await / return / catch required)
            "@typescript-eslint/no-floating-promises": "error",
            // async without await — drop the async keyword
            "@typescript-eslint/require-await": "error",
            // async fn passed to sync callback
            "@typescript-eslint/no-misused-promises": "error",
          },
          languageOptions: {
            parserOptions: {
              project: "./tsconfig.json",
              tsconfigRootDir: root,
            },
          },
        },
      ]),

  // eslint-config-prettier turns off all stylistic eslint rules that overlap
  // with prettier's authority on typography. Must be last.
  eslintConfigPrettier,
];
