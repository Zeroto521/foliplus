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

// One entry, not three. It registers the plugin itself rather than spreading
// `...tseslint.configs.recommended`, which would re-enable the rules pass 1
// deliberately turns off (no-explicit-any, no-unused-vars, no-require-imports)
// — this config adds three Promise rules and nothing else. The parser and the
// parserOptions live in the same block so there is one place that declares the
// language environment for these rules.
//
// eslint.config.js's `ignores` do not apply here: these rules need type
// information, so they are scoped by `files` to what tsconfig includes.
// test/js/** is out because it is not in the tsconfig program.
export default [
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
    },
  },
];
