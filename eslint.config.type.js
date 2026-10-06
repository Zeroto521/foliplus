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

const root = dirname(fileURLToPath(import.meta.url));

export default [
  ...base,
  {
    files: ["foliplus/js/**/*.ts"],
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: root,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/prefer-nullish-coalescing": [
        "error",
        { ignoreTernaryTests: true },
      ],
    },
  },
];
