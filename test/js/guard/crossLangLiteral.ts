// test/js/guard/crossLangLiteral — shared locator for Python↔JS twin-literal guards.
//
// Several constants exist as hand-copied twins, one per language: a regex in
// foliplus/_declaration/paint.py and the same regex in foliplus/js/platform/color.ts;
// the role words in foliplus/control/LayerControl/_role.py and the same words in
// foliplus/js/core/layer/const.ts; a folder-name bound in each. When one side
// widens or renames its copy and the other stays, a value the author declares
// through one channel is judged or painted differently through the other. A
// guard built on these locators fails at that drift instead of letting it ship.
//
// The locator is a capture regex over the source text, so each guarded constant
// states WHERE its twin lives and WHAT to pull out — the assertion itself is the
// one assertCrossLangLiteral call, not a bespoke test per constant.
import { repoPath } from "#test/path.js";
import fs from "node:fs";

/** Read a repo-relative source file. */
export const readSource = (relPath: string): string =>
  fs.readFileSync(repoPath(relPath), "utf8");

/** Pull the first capture group of locator out of a source file.
 *
 *  Throws (rather than returning undefined) so a guard whose locator stops
 *  matching — the twin was renamed or restructured — fails loudly instead of
 *  asserting against an empty string and passing. */
export const extractLiteral = (relPath: string, locator: RegExp): string => {
  const source = readSource(relPath);
  const match = source.match(locator);
  if (!match) {
    throw new Error(
      `crossLangLiteral: locator ${String(locator)} matched nothing in ${relPath}`,
    );
  }
  return match[1];
};

/** Assert two cross-language twin literals are byte-identical.
 *
 *  label names the constant in the failure message, so a drift reports
 *  which contract broke, not just that two strings differ. */
export const assertCrossLangLiteral = (
  pyLiteral: string,
  jsLiteral: string,
  label: string,
): void => {
  expect(jsLiteral, `${label}: Python and JS twins diverged`).toBe(pyLiteral);
};
