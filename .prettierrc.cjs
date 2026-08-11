// Prettier config for both local `npm run format` and pre-commit.ci.
// Uses require.resolve() so the @trivago plugin is found via NODE_PATH
// in pre-commit.ci's isolated environment (ESM import() does not honor
// NODE_PATH, causing "Cannot find package" from /code/noop.js).
// Keep these options in sync with the settings in package.json.
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
  importOrder: ["^[.]"],
  importOrderSeparation: false,
  importOrderSortSpecifiers: true,
};
