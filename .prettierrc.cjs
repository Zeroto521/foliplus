// Prettier config. Prettier loads it with its own config loader, which can
// parse CJS, so the plugin is loaded with require.resolve() — no need to
// mirror package.json's "prettier" block, which prettier itself would fail
// to read through ESM import() from its internal entry point in a stripped
// environment (ESM import() does not consult NODE_PATH, causing "Cannot
// find package" from /code/noop.js).
// @ts-check
/* eslint-env node */

/** @type {import("prettier").Config} */
module.exports = {
  singleQuote: false,
  trailingComma: "all",
  printWidth: 88,
  tabWidth: 2,
  singleAttributePerLine: false,
  useTabs: false,
  semi: true,
  bracketSpacing: true,
  arrowParens: "avoid",
  htmlWhitespaceSensitivity: "css",
  plugins: [require.resolve("@trivago/prettier-plugin-sort-imports")],
  importOrder: ["^#core/", "^#foliplus/", "^#common/", "^#script/", "^[.]"],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
};
