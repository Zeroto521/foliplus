import { describe, expect, it } from "vitest";
import { buildRows, parseArgs } from "#script/bundle-size-check.mjs";
import { FAIL, OK, STATUS, WARN } from "#script/glyph.mjs";

// glyph.mjs is four literals, so the tests here are about the contract the
// literals are load-bearing for, not about any logic of their own.

/** Every marker the module hands out, named, for a message that is actionable. */
const ALL: [string, string][] = [
  ["FAIL", FAIL],
  ["OK", OK],
  ["WARN", WARN],
  ...Object.entries(STATUS).map(([k, v]) => [`STATUS.${k}`, v] as [string, string]),
];

// Distinct outcomes that are allowed to render the same glyph. Each entry is a
// judgment, so each names the reason: the two must be unreadable-as-one, not
// merely different strings.
//
//   STATUS.over ≡ FAIL — over marks a threshold breach, FAIL marks a failed
//   read or write. A run that cannot write its report never reaches the verdict,
//   so they do not co-occur; where they could, STATUS.over is a table cell and
//   FAIL is a line prefix.
//
//   WARN ≡ STATUS.low — WARN prefixes an advisory block, STATUS.low marks a
//   per-row status. These two DO appear in the same console output: the
//   low-margin advisory is printed under the table. They stay readable because
//   they sit in different columns and carry different text — the advisory says
//   "N bundle(s) with <X% margin", the row names a file. If that ever feels
//   too close, give `low` its own marker rather than widening this list.
const DOCUMENTED_SHARED: [string, string][] = [
  ["STATUS.over", "FAIL"],
  ["WARN", "STATUS.low"],
];

// U+FE0E (text) and U+FE0F (emoji) are the variation selectors. The file exists
// to keep console tables column-aligned: an emoji-width marker shifts every
// column after it in a `padEnd`/`padStart` row.
const VARIATION_SELECTORS = [0xfe0e, 0xfe0f];

describe("marker shape", () => {
  it("each marker is a single variation-selector-free code point", () => {
    for (const [name, glyph] of ALL) {
      const cps = [...glyph].map(c => c.codePointAt(0) ?? 0);
      expect(cps.length, `${name} = ${JSON.stringify(glyph)}`).toBe(1);
      expect(
        VARIATION_SELECTORS.includes(cps[0]),
        `${name} = U+${cps[0].toString(16).toUpperCase()} — drop the variation selector`,
      ).toBe(false);
    }
  });

  it("no marker defaults to an emoji presentation", () => {
    // The property this file exists to hold. "One code point" is not enough on
    // its own: ✅ is a single code point and still renders emoji-wide, which is
    // exactly what shifts the columns after it. `Emoji_Presentation` is the
    // property that decides the default presentation, so it is the direct test.
    //
    // `Extended_Pictographic` is not a substitute — ⚠ has it and is not an
    // emoji, so it would flag a correct marker here.
    for (const [name, glyph] of ALL) {
      expect(
        /\p{Emoji_Presentation}/u.test(glyph),
        `${name} = ${JSON.stringify(glyph)} renders emoji-wide by default`,
      ).toBe(false);
    }
  });

  it("no two markers for distinct outcomes draw the same glyph", () => {
    // Two states that render identically read as one kind of row, so every pair
    // is checked rather than a hand-picked subset. The exceptions are the
    // judgment calls documented above.
    const glyphOf = (name: string) => ALL.find(([n]) => n === name)?.[1] ?? "";
    const isDocumented = (a: string, b: string) =>
      DOCUMENTED_SHARED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

    for (let i = 0; i < ALL.length; i++) {
      for (let j = i + 1; j < ALL.length; j++) {
        const [[a, ga], [b, gb]] = [ALL[i], ALL[j]];
        if (ga !== gb) continue;
        expect(
          isDocumented(a, b),
          `${a} and ${b} both render ${JSON.stringify(ga)} — distinct outcomes read as one`,
        ).toBe(true);
      }
    }

    // The exemption is not decorative: if STATUS.over ever stopped sharing a
    // glyph with FAIL, this would keep passing on a stale entry.
    for (const [a, b] of DOCUMENTED_SHARED) {
      expect(
        glyphOf(a) === glyphOf(b),
        `DOCUMENTED_SHARED (${a}, ${b}) no longer shares a marker — drop the entry`,
      ).toBe(true);
    }
  });
});

// bundle-size-check's `rowCells` renders a row as `STATUS[r.status] || "·"`.
// An unmarked status therefore does not fail — it renders as the "unchanged"
// dot while the label column still says OVER. Both directions are pinned here:
// every status the tool can emit must have a marker, and every marker must name
// a status the tool actually emits.
describe("marker table matches the status vocabulary", () => {
  /** Every status `buildRows` can produce, through its public surface.
   *
   * The percentage is swept rather than hand-picked: picked values silently
   * encode the current threshold and its margin band, so a change to either
   * would red this test about bundle-size-check instead of about glyph.mjs.
   * Sweeping from three times below to three times above the threshold
   * collects whatever the current config can emit, and the range follows the
   * threshold if it moves. */
  const statuses = (): Set<string> => {
    const { threshold } = parseArgs([]);
    const base = 1000;
    const seen = new Set<string>();
    for (let pct = -3 * threshold; pct <= 3 * threshold; pct++) {
      const curr = Math.max(0, Math.round(base * (1 + pct / 100)));
      for (const r of buildRows(
        { "diff.min.js": curr, "new.min.js": base },
        { files: { "diff.min.js": base, "missing.min.js": base } },
        threshold,
      )) {
        seen.add(r.status);
      }
    }
    return seen;
  };

  it("every emitted status has a marker and vice versa", () => {
    expect(statuses()).toEqual(new Set(Object.keys(STATUS)));
  });
});
