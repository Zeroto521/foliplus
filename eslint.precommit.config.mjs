// eslint config for the pre-commit `lint-eslint` hook.
//
// Deliberately a tiny, dependency-free subset of eslint.config.js, and JS-only
// (no `.ts`): the full config imports typescript-eslint and
// eslint-config-prettier, both ESM packages supplied through
// additional_dependencies. In pre-commit.ci those deps land under NODE_PATH
// rather than next to package.json, and neither the ESM nor the CJS resolver
// consults NODE_PATH by package name — measured: a bare `import`, a bare
// `require()`, and a bare `createRequire("name")` all fail identically, and
// typescript-eslint is exports-only ESM so CJS `require()` cannot load it at
// all. A bare ESM `import` therefore cannot work in that env, so this hook
// reads a config that needs no imports whatsoever, which also means no TS
// parser plugin — hence the JS-only scope.
//
// Only the two rules that pre-commit is actually good at live here: fast,
// mechanical, auto-fixable checks needing neither the TS parser nor type
// information. Everything else (quality rules, padding, Promise discipline,
// all of `test/js` and `script` coverage) runs via `npm run lint` in GitHub
// Actions, where the real node_modules are present. `ignores` is repeated here
// rather than leaning on the hook's `exclude`, because the config is meant to
// be runnable in isolation with --no-config-lookup.
export default [
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
    files: ["**/*.{js,cjs,mjs}"],
    rules: {
      "no-var": "error",
      "no-debugger": "error",
    },
  },
];
