// ESLint config — pass 2, the type-aware Promise-discipline rules. Run it with
// `npm run typecheck`, which runs `tsc --noEmit` first and then
// `eslint -c eslint.config.js -c eslint.config.type.js`.
//
// These three rules need the TypeScript type system, so they are held here
// rather than in eslint.config.js: keeping them out of pass 1 means that
// config imports no typescript package at all.
//
// They are reported alongside `tsc --noEmit` because both read the same
// tsconfig program — a Promise-discipline failure is a type error and belongs
// next to the other type errors.
//
// `no-floating-promises` is the workhorse: an unhandled Promise needs an
// `await`, a `return`, or a `.catch`. `require-await` catches `async`
// functions that never await, so the keyword can be dropped.
// `no-misused-promises` catches an async function handed to a callback
// position that expects a sync return value.
//
// @see https://typescript-eslint.io/rules/no-floating-promises/

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

const root = dirname(fileURLToPath(import.meta.url));

export default [
  // Register the plugin. eslint.config.js's `files` scope does not reach the
  // type-aware rules below, so it must be defined here for
  // `@typescript-eslint/*` to resolve. Defined as a bare plugin entry rather
  // than `...tseslint.configs.recommended` because that spread would re-enable
  // the recommended rules that pass 1 deliberately turns off
  // (no-explicit-any, no-unused-vars, no-require-imports) — this config adds
  // three Promise rules and nothing else.
  {
    plugins: { "@typescript-eslint": tseslint.plugin },
    languageOptions: { parser: tseslint.parser },
  },

  {
    ignores: [
      "node_modules/**",
      "foliplus/dist/**",
      "test/js/browser/**",
      "doc/**",
      "script/sonda/**",
    ],
  },

  {
    files: ["foliplus/js/**/*.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: root,
      },
    },
  },
];
