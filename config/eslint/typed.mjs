// ESLint config — pass 2, the type-aware rules (Promise discipline, nullish /
// optional-chain upgrades, export kind). Run it with `npm run typecheck`, which runs
// `tsc --noEmit` first and then `eslint -c config/eslint/typed.mjs`.
//
// This file spreads base.mjs as its base: `...base` carries the TS
// parser + `@typescript-eslint` plugin registration (from
// `...tseslint.configs.recommended`) and every quality rule pass 1 owns
// (no-eval, no-implicit-coercion, no-unused-vars, …) into this config. The
// appended block adds parserOptions with the tsconfig project so type-aware
// rules can read the type system, plus those rules themselves.
//
// Why spread instead of `eslint -c a -c b`: ESLint 9's `-c` flag only applies
// the last one, so the double-config command silently dropped every pass 1
// rule in typecheck (T298). Spreading base inline keeps both layers in one
// config array without a second CLI pass.
//
// Type-aware rule list (all scoped to foliplus/js/**/*.ts, which is what
// tsconfig includes — test/js/** is out because it isn't in the program):
//   no-floating-promises  — unhandled Promise needs an `await`, `return`, or
//                           `.catch`.
//   require-await         — `async` functions that never await, so the
//                           keyword can be dropped.
//   no-misused-promises   — an async function handed to a callback position
//                           that expects a sync return value.
//   prefer-optional-chain — `a && a.b` → `a?.b`. Type-narrowed: catches cases
//                           the syntax-only variant misses (`string & ""` etc).
//   prefer-nullish-coalescing — `x || fallback` → `x ?? fallback` when the
//                           fallback only needs null/undefined, not every
//                           falsy value. `ignoreTernaryTests` keeps `cond ? x : y`
//                           out of scope (the rule would propose `cond ?? x`,
//                           a different expression).
//   consistent-type-exports — a type-only export gets its own
//                           `export type { … }` statement; inline
//                           `export { A, type B }` is rejected. Imports stay
//                           inline (base.mjs), exports split.
//
// @see https://typescript-eslint.io/rules/no-floating-promises/
// @see https://typescript-eslint.io/rules/consistent-type-exports/
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import base from "./base.mjs";

const importPlugin = (await import("eslint-plugin-import")).default;

// `tsconfigRootDir` must be the repository root, not this file's directory:
// `project: ["./tsconfig.json"]` is resolved against it, and this config now
// lives two levels down. `import.meta.url` is the only reliable anchor —
// `process.cwd()` would change with the caller's working directory.
const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(dirname(here)); // config/eslint/ -> config/ -> repo root

export default [
  ...base,
  {
    files: ["foliplus/js/**/*.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin, import: importPlugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.json"],
        tsconfigRootDir: root,
      },
    },
    rules: {
      // Type/value export split. Imports deliberately go the other way:
      // base.mjs's consistent-type-imports keeps them inline
      // (`import { type A, B }`) so there is one import per module. Exports
      // instead give a type-only export its own `export type { … }` statement
      // — `export { A, type B }` is rejected — which keeps "what leaves this
      // module as a value" visually separate from "what only exists for
      // typing" and lines up with the single bottom `export { … }` block
      // convention.
      //
      // Runs here rather than next to consistent-type-imports in base.mjs:
      // the rule resolves TS symbols (`requiresTypeChecking: true`) to tell a
      // type from a value, so it needs the tsconfig program — same reason as
      // import/no-unused-modules below.
      //
      // v8 renamed the old `fixStyle: "separate-type-exports"` option to
      // `fixMixedExportsWithInlineTypeSpecifier`: the default (false) is the
      // separate-statement fix (`export { A, type B }` → `export type { B };`
      // + `export { A };`), while `true` would keep the inline form this rule
      // exists to forbid. Kept explicit so a future default flip cannot change
      // the autofix style silently.
      "@typescript-eslint/consistent-type-exports": [
        "error",
        { fixMixedExportsWithInlineTypeSpecifier: false },
      ],

      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-misused-promises": "error",

      // `a && a.b` → `a?.b`. Type-aware (narrows by type); the non-type
      // variant is a syntax-level shortcut that misses `string & ""` and
      // other edge cases the type info catches.
      "@typescript-eslint/prefer-optional-chain": "error",

      // `x || fallback` → `x ?? fallback` when the fallback path only needs
      // null/undefined, not every falsy value. The rule's type analysis
      // narrows each hit — `x || 0`, `x || ""`, `x || false` all stay
      // alone because `??` would change semantics. `ignoreTernaryTests`
      // keeps `cond ? x : y` out of scope (the rule would propose a
      // `cond ?? x`, which is a different expression, not an operator
      // upgrade).
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignoreTernaryTests: true },
      ],

      // Dead-export detector. Catches exports that nothing in the tree
      // imports — a bug smell in production code and a bundle-size leak.
      //
      // Runs here (with `parserOptions.project`) rather than in the base
      // config because the rule needs the TS program to resolve imports
      // across the codebase. Without the program, the resolver can't
      // follow `#common/*` or `#core/*` aliases and fires on every export.
      //
      // The rule reads `.eslintrc.json` for its ignore patterns (a
      // flat-config limitation — see eslint-plugin-import#3079); the
      // file at the repo root mirrors the flat-config `ignores`.
      //
      // `ignoreExports` exempts the structural surfaces the rule can't
      // see as consumers: re-export bridges and component entry points
      // (index.ts), type-only modules (type.ts), test fixtures, build
      // tooling, and config-schema.ts (consumed by Python's Jinja
      // loader). Type-only dead exports are caught by the rule like any
      // other — the `ignoreUnusedTypeExports` option was tested and found
      // ineffective for standalone `export type { X }` statements (the
      // 6 dead exports in this PR fired with the option enabled), so it
      // has been removed. The rule then only fires on internal modules,
      // where dead exports actually hide.
      "import/no-unused-modules": [
        "error",
        {
          unusedExports: true,
        },
      ],
    },
  },
  {
    files: [
      "foliplus/js/**/index.ts",
      "foliplus/js/**/type.ts",
      "foliplus/js/config-schema.ts",
      "test/js/**/*.{js,ts}",
      "script/**/*.{js,cjs,mjs}",
    ],
    rules: {
      "import/no-unused-modules": "off",
    },
  },
];
