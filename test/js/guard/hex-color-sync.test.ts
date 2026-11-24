// The marker chassis hex shape sync guard: the Python declaration reader and
// the JS color primitive must judge the same CSS hex shapes the same way.
//
// _HEX_COLOR_RE in foliplus/_declaration.py is a hand-copied twin of the
// isHexColor regex in foliplus/js/platform/color.ts (the #1275 follow-up
// card): one side widening the accepted hex shape while the other stays
// would let a hex the Python channel accepts paint one colour and the JS
// channel reject — the two channels must carry the same string for one
// chassis colour. This guard extracts the regex literal from BOTH source
// files (through the shared crossLangLiteral locator) and asserts (1) the
// literals are identical, (2) the same hex sample set judges consistently on
// both sides, and (3) both channels normalise a 3-digit hex to the same
// #rrggbb lowercase form.
import { repoPath } from "#test/path.js";
import { assertCrossLangLiteral, extractLiteral } from "./crossLangLiteral.js";
import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { isHexColor, normalizeHexColor } from "#platform/color.js";

const PY_DECL = "foliplus/_declaration.py";
const JS_COLOR = "foliplus/js/platform/color.ts";

/** The Python _HEX_COLOR_RE twin, pulled through the shared locator. */
const readPyHexRe = (): string =>
  extractLiteral(PY_DECL, /_HEX_COLOR_RE = re\.compile\(r"([^"]+)"\)/);

/** The JS isHexColor shape regex twin, pulled through the shared locator. */
const readJsHexRe = (): string =>
  extractLiteral(
    JS_COLOR,
    /typeof value === "string" && \/(\^#[^/]+)\/\.test\(value\)/,
  );

// A broad hex-shaped sample set: valid 3/6-digit (mixed case), malformed
// lengths, non-hex digits, missing hash, whitespace, empty, non-string, and
// CSS colour forms that must NOT be mistaken for a hex shape.
const HEX_SAMPLES: unknown[] = [
  "#fff",
  "#FFF",
  "#AbC",
  "#FfF",
  "#000",
  "#abc",
  "#12abef",
  "#123ABC",
  "#12AbEf",
  "#FfFfFf",
  "#abcdef",
  "#000000",
  "#1234",
  "#12345",
  "#1234567",
  "#12",
  "#12345678",
  "#ggg",
  "#12ag",
  "#12g",
  "fff",
  "red",
  "blue",
  "rgb(1, 2, 3)",
  "rgba(1, 2, 3, 0.5)",
  "#",
  "",
  "  #fff",
  "#fff  ",
  "white",
  "##fff",
  "#12345G",
  "#abcd",
  "#abcde",
  "12abef",
  123,
  null,
  undefined,
  "#f00",
  "#F00",
  "#0f0",
  "#00f",
];

describe("marker chassis hex shape stays in step across Python and JS", () => {
  const pyRe = readPyHexRe();
  const jsRe = readJsHexRe();
  const pyRegExp = new RegExp(pyRe);
  const jsRegExp = new RegExp(jsRe);

  it("carries one identical hex shape regex literal on both sides", () => {
    assertCrossLangLiteral(pyRe, jsRe, "hex shape regex");
  });

  it("judges the same hex sample set consistently on both sides", () => {
    for (const s of HEX_SAMPLES) {
      const pyVerdict = pyRegExp.test(String(s));
      const jsVerdict = jsRegExp.test(String(s));
      expect(pyVerdict, `py vs js for ${JSON.stringify(s)}`).toBe(jsVerdict);
      if (typeof s === "string") {
        // The runtime JS primitive must agree with its own extracted regex.
        expect(isHexColor(s), `isHexColor for ${JSON.stringify(s)}`).toBe(jsVerdict);
      }
    }
  });

  it("normalises a 3-digit hex to the same #rrggbb lowercase on both sides", () => {
    // The JS primitive expands and lowers; the Python source must carry the
    // same expansion (f"#{r}{r}{g}{g}{b}{b}".lower()) for one chassis string.
    const pySrc = fs.readFileSync(repoPath(PY_DECL), "utf8");
    expect(pySrc).toContain('f"#{r}{r}{g}{g}{b}{b}".lower()');
    for (const s of ["#fff", "#AbC", "#FfF", "#000", "#abc", "#f00"]) {
      expect(normalizeHexColor(s)).toBe(
        `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase(),
      );
    }
  });
});
