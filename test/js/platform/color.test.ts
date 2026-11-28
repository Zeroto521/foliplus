import { repoPath } from "#test/path.js";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeColorAlpha,
  isHexColor,
  normalizeHexColor,
  parseColorAlpha,
} from "#platform/color.js";
import { stripComments } from "#script/check/scan-locale-key.mjs";

/** Contract boundary for the single-source hex scan.
 *
 *  What it sees: a plain slash-delimited regex literal whose body contains an
 *  unescaped '#' followed, within a fixed 12-character window, by an explicit
 *  hex character class — a digit range plus an 'a-f'/'A-F' range, in either
 *  order ([0-9a-f], [0-9A-F], [a-f0-9], [\da-f]). That catches every
 *  hand-rolled form found so far (/^#[0-9a-f]{6}$/i,
 *  /^#[0-9a-fA-F]{3}(...)?$/, /#[0-9a-f]{3,6}/) and does not flag a CSS-id
 *  regex such as /#[a-z][\w-]+/i, which carries both a '#' and a class but no
 *  hex range.
 *
 *  What it deliberately does not count: a loose class that merely includes
 *  hex characters — /#[0-9a-z]{6}/ and /#\w{6}/ judge false. Only the
 *  explicit 'a-f' range is a hex matcher; the /#[0-9a-z]{6}/ case is pinned
 *  in the tests below.
 *
 *  What it cannot see, left to review by contract:
 *   1. a value tested after slice(1) — the '#' is gone before the test;
 *   2. a string-built regex — new RegExp("^#[0-9a-f]{6}$");
 *   3. a regex after '//' on the same line — stripComments cuts the line at a
 *      '//' inside an earlier string literal (a URL), hiding the real regex;
 *   4. an escaped spelling: the scan skips a '#' whose preceding character is
 *      a backslash, so a genuine '\\#' (escaped backslash, unescaped '#') is
 *      skipped too, and a '\x23' spelling of '#' is invisible altogether.
 */

/** The literal bodies in the source: slash-delimited, no raw slash or newline
 *  inside, flags ignored. new RegExp(...) and friends are not literals. */
const regexLiterals = (src: string): string[] =>
  [...src.matchAll(/\/(?:\\.|[^/\n\\])*\/([a-z]*)/g)].map(m => m[0]);

/** A hex character class after a '#': a digit range plus an 'a-f'/'A-F'
 *  range, in either order ([0-9a-f], [0-9A-F], [a-f0-9], [\da-f]).
 *  Case-blind on purpose: [0-9a-f] and [0-9A-F] encode the same shape. */
const HEX_CLASS_AFTER_HASH =
  /^#.{0,12}\[(?:[^\]]*(?:0-9|\\d)[^\]]*(?:a-f|A-F)|[^\]]*(?:a-f|A-F)[^\]]*(?:0-9|\\d))/;

/** True when a literal body is a hand-rolled hex matcher. */
const isHandRolledHexLiteral = (body: string): boolean => {
  for (let at = body.indexOf("#"); at >= 0; at = body.indexOf("#", at + 1)) {
    if (body[at - 1] === "\\") continue;
    if (HEX_CLASS_AFTER_HASH.test(body.slice(at))) return true;
  }
  return false;
};

describe("normalizeHexColor", () => {
  it("expands a 3-digit hex to 6 digits", () => {
    expect(normalizeHexColor("#fff")).toBe("#ffffff");
    expect(normalizeHexColor("#AbC")).toBe("#aabbcc");
  });

  it("leaves a 6-digit hex alone", () => {
    expect(normalizeHexColor("#12abef")).toBe("#12abef");
  });

  it("passes a non-hex value through unchanged", () => {
    expect(normalizeHexColor("red")).toBe("red");
    expect(normalizeHexColor("")).toBe("");
  });
});

describe("isHexColor", () => {
  it("accepts 3- and 6-digit hex, case-insensitive", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#FFFFFF")).toBe(true);
    expect(isHexColor("#12abef")).toBe(true);
  });

  it("rejects non-hex and malformed hex", () => {
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#fff1")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
    expect(isHexColor("")).toBe(false);
    expect(isHexColor(null)).toBe(false);
    expect(isHexColor(123)).toBe(false);
  });
});

describe("parseColorAlpha", () => {
  it("parses 3- and 6-digit hex as opaque", () => {
    expect(parseColorAlpha("#12abef")).toEqual({ hex: "#12abef", alpha: 100 });
    expect(parseColorAlpha("#ABC")).toEqual({ hex: "#aabbcc", alpha: 100 });
  });

  it("parses rgb() as opaque", () => {
    expect(parseColorAlpha("rgb(255, 0, 0)")).toEqual({
      hex: "#ff0000",
      alpha: 100,
    });
  });

  it("parses rgba() with a float alpha", () => {
    expect(parseColorAlpha("rgba(255, 0, 0, 0.5)")).toEqual({
      hex: "#ff0000",
      alpha: 50,
    });
    expect(parseColorAlpha("rgba(18, 171, 239, 0.33)")).toEqual({
      hex: "#12abef",
      alpha: 33,
    });
  });

  it("returns null for values it cannot turn into hex+alpha", () => {
    expect(parseColorAlpha("blue")).toBeNull();
    expect(parseColorAlpha("var(--x)")).toBeNull();
    expect(parseColorAlpha("")).toBeNull();
    expect(parseColorAlpha("  ")).toBeNull();
  });
});

describe("composeColorAlpha", () => {
  it("returns the hex itself at alpha 100", () => {
    expect(composeColorAlpha("#12abef", 100)).toBe("#12abef");
  });

  it("composes rgba below 100", () => {
    expect(composeColorAlpha("#ff0000", 50)).toBe("rgba(255, 0, 0, 0.5)");
    expect(composeColorAlpha("#12abef", 33)).toBe("rgba(18, 171, 239, 0.33)");
    expect(composeColorAlpha("#0000ff", 0)).toBe("rgba(0, 0, 255, 0)");
  });
});

describe("single home for the hex color regexes", () => {
  it("recognises a hand-rolled hex regex in any case and with any flags", () => {
    // The four shapes that were in the tree before this guard was widened.
    expect(isHandRolledHexLiteral("^#[0-9a-fA-F]{6}$")).toBe(true);
    expect(isHandRolledHexLiteral("^#[0-9a-f]{6}$")).toBe(true);
    expect(isHandRolledHexLiteral("^#([0-9a-f])([0-9a-f])([0-9a-f])$")).toBe(true);
    expect(isHandRolledHexLiteral("#[0-9a-f]{3,6}")).toBe(true);
    // Equivalent hex-class spellings: reversed ranges and \d.
    expect(isHandRolledHexLiteral("^#[A-F0-9]{6}$")).toBe(true);
    expect(isHandRolledHexLiteral("^#[\\da-f]{3}$")).toBe(true);
  });

  it("does not mistake a CSS-id regex for a hex matcher", () => {
    expect(isHandRolledHexLiteral("#[a-z][\\w-]*")).toBe(false);
    expect(isHandRolledHexLiteral("^#[a-z][a-z0-9_-]*$")).toBe(false);
    expect(isHandRolledHexLiteral("#[0-9a-z]{6}")).toBe(false);
    // Contract blind spot 4: an escaped '#' spelling is out of scope.
    expect(isHandRolledHexLiteral("^\\#[0-9a-f]{6}$")).toBe(false);
  });

  it("keeps every hex regex in platform/color.ts", () => {
    const root = repoPath(".");
    const jsRoot = path.join(root, "foliplus", "js");
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "dist") continue;
          walk(p);
        } else if (entry.name.endsWith(".ts")) {
          files.push(p);
        }
      }
    };
    walk(jsRoot);
    // A hex regex literal anywhere but color.ts is a second copy of the rule
    // the platform module owns — whatever its case or flags. Comments are
    // stripped first so a doc line such as `#rgb` / `#rrggbb` does not read
    // as a regex literal.
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(path.join("platform", "color.ts"))) continue;
      const src = stripComments(fs.readFileSync(file, "utf8"));
      if (regexLiterals(src).some(isHandRolledHexLiteral)) {
        offenders.push(path.relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
    // The scan is only meaningful while color.ts still owns the hex shape.
    const colorSource = fs.readFileSync(
      path.join(jsRoot, "platform", "color.ts"),
      "utf8",
    );
    expect(colorSource).toMatch(/\^#\[/);
  });
});
