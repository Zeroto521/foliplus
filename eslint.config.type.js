// ESLint config — pass 2, the type-aware rules (Promise discipline + nullish /
// optional-chain upgrades). Run it with `npm run typecheck`, which runs
// `tsc --noEmit` first and then `eslint -c eslint.config.type.js`.
//
// This file spreads eslint.config.js as its base: `...base` carries the TS
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
//
// @see https://typescript-eslint.io/rules/no-floating-promises/
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";
import base from "./eslint.config.js";

const importPlugin = (await import("eslint-plugin-import")).default;

const root = dirname(fileURLToPath(import.meta.url));

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
      // config because `ignoreUnusedTypeExports` needs the TS program to
      // distinguish type-only exports from value exports. Without the
      // program, the rule can't tell `export type { Foo }` from
      // `export { Foo }` and fires on every type export.
      //
      // The rule reads `.eslintrc.json` for its ignore patterns (a
      // flat-config limitation — see eslint-plugin-import#3079); the
      // file at the repo root mirrors the flat-config `ignores`.
      //
      // `ignoreExports` exempts the structural surfaces the rule can't
      // see as consumers: re-export bridges and component entry points
      // (index.ts), type-only modules (type.ts), test fixtures, build
      // tooling, and config-schema.ts (consumed by Python's Jinja
      // loader). `ignoreUnusedTypeExports` handles TS type-only edges
      // the resolver can't track. The rule then only fires on internal
      // modules, where dead exports actually hide.
      "import/no-unused-modules": [
        "error",
        {
          unusedExports: true,
          ignoreUnusedTypeExports: true,
          ignoreExports: [
            "**/index.ts",
            "**/type.ts",
            "foliplus/js/config-schema.ts",
            "test/js/**/*.{js,ts}",
            "script/**/*.{js,cjs,mjs}",
          ],
        },
      ],

      // Unnecessary condition guard — catches `if (x)` where the type of `x`
      // guarantees it's always truthy, and `if (!x)` where `x` is always
      // truthy (so the `!` is dead). This is a silent-logic bug: the branch
      // never executes, but the code reads like it might. `checkTypePredicates`
      // extends the check to type guards (`x is string` — flags when the
      // predicate is always true for the given type).
      //
      // DISABLED: produces 254 false positives where ESLint says optional
      // chains/conditionals are unnecessary but TypeScript disagrees (the
      // objects could be undefined/null). Re-enable after the rule's type
      // narrowing is fixed or after refactoring the affected code.
      // "@typescript-eslint/no-unnecessary-condition": [
      //   "error",
      //   { checkTypePredicates: true },
      // ],
    },
  },
];
