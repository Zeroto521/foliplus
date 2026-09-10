// Prettier config. Prettier loads it with its own config loader, which can
// parse CJS, so the plugin is loaded with require.resolve().
//
// This is only a workaround for pre-commit.ci, which installs the declared
// additional_dependencies under NODE_PATH instead of next to package.json.
// It is NOT because require.resolve() is special: a bare
// require("@trivago/prettier-plugin-sort-imports") fails there too. The
// load that survives is one by absolute path — and it survives only because
// prettier never asks for the plugin by name, it imports the resolved path
// we hand it. The same import in another config still fails in the isolated
// env. Locally, package.json's "prettier" block would work fine; the CJS
// file exists so both environments read the same config.
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
