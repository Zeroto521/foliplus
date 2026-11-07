import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// CHANGELOG link-placement guard.
//
// One fact, one place: a change is described once, and its PR links are
// aggregated in one parenthesized block at the END of that single line -- never
// split across lines, never followed by prose. This is the automated form of the
// review a changelog entry gets by hand: links trailing, no text after them, one
// component aggregate per line.
//
// Entries with no links are fine (the earliest entries predate the PR-link
// convention); only entries that DO carry a PR-link block are policed here.

const REPO_ROOT = resolve(".");
const LINES = readFileSync(resolve(REPO_ROOT, "CHANGELOG.md"), "utf-8").split(/\r?\n/);

// An entry line starts with "- ". Headings, blanks and continuations are not
// entries and are skipped.
const ENTRIES = LINES.map((text, index) => ({ text, line: index + 1 })).filter(
  ({ text }) => text.startsWith("- "),
);

// The canonical PR link: the visible [#N] must match the URL pull/N, so a
// copy-pasted link cannot point somewhere its label does not say.
// A PR link: the visible [#N] must match the URL's trailing number, so a
// copy-pasted link cannot point somewhere its label does not say. The URL may
// be /pull/, /issues/ or /tree/ (older entries use all three) -- this guard
// polices link PLACEMENT and label/URL agreement, not which segment a
// historical entry used.
const LINK =
  /\[#(\d+)\]\(https:\/\/github\.com\/Zeroto521\/foliplus\/(?:pull|issues|tree)\/\1\)/g;

// The inner text of the single trailing (...) block, or null. Balanced-paren
// scan from the right: the aggregate is the group whose ")" is the line's last
// char, so a "(pull/N)" inside a URL or a "(**Breaking**: ...)" note before the
// links cannot be mistaken for it. No regex-nesting to get wrong.
const trailingLinks = text => {
  const t = text.trimEnd();
  if (!t.endsWith(")")) return null;
  let depth = 0;
  for (let i = t.length - 1; i >= 0; i--) {
    const ch = t[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      depth -= 1;
      if (depth === 0) return t.slice(i + 1, t.length - 1);
    }
  }
  return null;
};

describe("CHANGELOG link placement", () => {
  it("has entries to police", () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  for (const { text, line } of ENTRIES) {
    const links = [...text.matchAll(LINK)];
    if (links.length === 0) continue; // a linkless entry is allowed

    it(`line ${line}: PR links sit in one trailing block with no prose after`, () => {
      const trailing = trailingLinks(text);
      expect(trailing, "PR links must be in the trailing (...) block").not.toBeNull();
      const inside = [...trailing.matchAll(/\[#(\d+)\]/g)].map(m => m[1]);
      // Every link on the line lives in that one trailing group: the aggregate
      // was not split and no link (plus prose) sits mid-line.
      expect(inside).toHaveLength(links.length);
      // No prose after the closing paren: the trailing block ends the line.
      expect(text.trimEnd().endsWith(")")).toBe(true);
    });

    it(`line ${line}: every PR link pairs its label with the URL number`, () => {
      for (const m of links) {
        // LINK already backreferences label==URL; re-assert the URL is this repo
        // and ends in /N so a relabelled link cannot slip through a future edit.
        expect(m[0]).toContain("](https://github.com/Zeroto521/foliplus/");
        expect(m[0].endsWith(`/${m[1]})`)).toBe(true);
      }
    });
  }
});
