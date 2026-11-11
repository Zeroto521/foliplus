import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeColorAlpha,
  isHexColor,
  normalizeHexColor,
  parseColorAlpha,
} from "#core/color.js";

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

describe("single home for the hex/rgba regexes", () => {
  it("keeps every hex/rgba regex in core/color.ts", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(here, "../../..");
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
    const colorSource = fs.readFileSync(path.join(jsRoot, "core", "color.ts"), "utf8");
    const colorRegexCount = [/\^#\[0-9a-fA-F\]/, /rgba?\(/].filter(r =>
      r.test(colorSource),
    ).length;
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith(path.join("core", "color.ts"))) continue;
      const src = fs.readFileSync(file, "utf8");
      // A hex regex literal or an rgb()/rgba() regex literal anywhere but color.ts
      const m = src.match(/\/(?:\^#\[0-9a-fA-F\]|rgba?\s*\()/);
      if (m) offenders.push(path.relative(root, file));
    }
    expect(offenders).toEqual([]);
    expect(colorRegexCount).toBeGreaterThan(0);
  });
});
