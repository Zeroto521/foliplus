import { describe, expect, it } from "vitest";
import { buildRows } from "#script/bundle-size-check.mjs";
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

  it("distinct outcomes do not draw the same marker", () => {
    // Two states that render identically read as one kind of row. `STATUS.over`
    // and `FAIL` do share a glyph by design — they sit in a table cell and a
    // line prefix respectively, so they are never on screen together.
    expect(OK).not.toBe(FAIL);
    expect(OK).not.toBe(WARN);
    expect(FAIL).not.toBe(WARN);
    expect(STATUS.up).not.toBe(STATUS.down);
  });
});

// bundle-size-check's `rowCells` renders a row as `STATUS[r.status] || "·"`.
// An unmarked status therefore does not fail — it renders as the "unchanged"
// dot while the label column still says OVER. Both directions are pinned here:
// every status the tool can emit must have a marker, and every marker must name
// a status the tool actually emits.
describe("marker table matches the status vocabulary", () => {
  /** Every status `buildRows` can produce, through its public surface. */
  const statuses = (): Set<string> => {
    const rows = buildRows(
      {
        "same.min.js": 200, // pct 0 → "same"
        "up.min.js": 101, // pct +1 → "up"
        "down.min.js": 99, // pct -1 → "down"
        "low.min.js": 106, // pct +6 → inside the 5-point low-margin band
        "over.min.js": 111, // pct +11 → past the 10-point threshold
        "new.min.js": 10, // absent from the baseline
      },
      {
        files: {
          "same.min.js": 200,
          "up.min.js": 100,
          "down.min.js": 100,
          "low.min.js": 100,
          "over.min.js": 100,
          "missing.min.js": 10, // gone from the build
        },
      },
      10,
    );
    return new Set(rows.map(r => r.status));
  };

  it("every emitted status has a marker and vice versa", () => {
    expect(statuses()).toEqual(new Set(Object.keys(STATUS)));
  });
});
