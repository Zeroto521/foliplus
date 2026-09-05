// ESLint config for the foliplus JS/TS runtime and test suite.
// Prettier handles typography (indent, width, quotes, import order);
// eslint handles structural rules prettier cannot express:
//   - blank lines between statements (Python E302 / E305 equivalent)
//   - Promise discipline (no-floating-promises, require-await, no-misused-promises)
// Both run in pre-commit.ci via the format-prettier / format-eslint hooks.
//
// Two passes over the TS sources:
//   1. Non-type-aware rules (padding-line-between-statements) — fast, AST only.
//   2. Type-aware rules (Promise discipline) — slower, needs tsconfig program.
// test/js is not in tsconfig include (see tsconfig.json comment), so the
// type-aware pass only covers foliplus/js.
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));

// pre-commit runs eslint in an isolated env without the full tsconfig
// program; type-aware rules are enforced by `npm run lint` in CI instead.
const skipTypecheck = process.env.FOLIPLUS_PRE_COMMIT === "1";

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

  // ── Pass 1: structural rules prettier cannot enforce (no type info) ──
  {
    files: [
      "foliplus/js/**/*.ts",
      "test/js/**/*.ts",
      "script/**/*.mjs",
      "script/**/*.cjs",
      "script/**/*.js",
    ],
    rules: {
      // Blank lines between statements (Python E302 / E305).
      // Prettier preserves existing blank lines but never adds or removes them;
      // this rule enforces the project convention.
      // Legal `next` values (see rule source): *, block-like, expression, iife,
      // function, class, const, import, for, if, switch, try, while, var, let,
      // export, return, break, case, continue, default, do, debugger, throw,
      // with, block, empty, multiline-const, multiline-let, multiline-var,
      // singleline-const, singleline-let, singleline-var,
      // multiline-block-like, multiline-expression, cjs-import, cjs-export,
      // directive. There is NO "comment" or "call" value.
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "*", next: "function" },
        { blankLine: "always", prev: "*", next: "class" },
        { blankLine: "always", prev: "*", next: "expression" },
        { blankLine: "always", prev: "*", next: "multiline-const" },
        { blankLine: "always", prev: "*", next: "multiline-expression" },
      ],

      // tsc --noEmit already checks unused vars (noUnusedLocals)
      "@typescript-eslint/no-unused-vars": "off",
      "no-unused-vars": "off",

      // Heavy-mock test suite and Leaflet interop make `any` idiomatic here.
      // tsconfig's noImplicitAny still catches implicit ones.
      "@typescript-eslint/no-explicit-any": "off",

      // Test scripts exercise the CJS build tooling via require().
      "@typescript-eslint/no-require-imports": "off",

      // Project convention: `a && b()` / `cond ? x() : y()` statement
      // expressions (reindexAfterMove, add/removeLayer branches).
      "@typescript-eslint/no-unused-expressions": "off",
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
