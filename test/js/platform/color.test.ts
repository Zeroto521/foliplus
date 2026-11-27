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

/** A JS regex literal — slash-delimited, any flags — whose body is a
 *  hand-rolled hex matcher. Case-blind on purpose: `[0-9a-f]` and `[0-9A-F]`
 *  encode the same color shape, and an `i` flag changes how the literal is
 *  read, not whether it is a second copy of the shared rule. `^#` covers the
 *  anchored hex forms, `#[` an unanchored one. */
const HANDROLLED_HEX_REGEX = /\/(?:\\.|[^/\n\\])*(?:\^#|#\[)(?:\\.|[^/\n\\])*\//;

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
    expect(HANDROLLED_HEX_REGEX.test("/^#[0-9a-fA-F]{6}$/")).toBe(true);
    expect(HANDROLLED_HEX_REGEX.test("/^#[0-9a-f]{6}$/i")).toBe(true);
    expect(HANDROLLED_HEX_REGEX.test("/^#([0-9a-f])([0-9a-f])([0-9a-f])$/")).toBe(true);
    expect(HANDROLLED_HEX_REGEX.test("/#[0-9a-f]{3,6}/")).toBe(true);
    expect(HANDROLLED_HEX_REGEX.test("const ratio = width / height;")).toBe(false);
    expect(HANDROLLED_HEX_REGEX.test('const color = "rgba(0, 0, 0, 0.5)";')).toBe(
      false,
    );
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
      if (HANDROLLED_HEX_REGEX.test(stripComments(fs.readFileSync(file, "utf8")))) {
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
