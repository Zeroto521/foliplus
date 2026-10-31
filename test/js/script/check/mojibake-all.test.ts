import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("mojibake-all", () => {
  it("batches mojibake_check.py over tracked files (never one giant argv)", () => {
    const src = readFileSync(resolve("script/check/mojibake-all.mjs"), "utf8");
    expect(src).toContain("i += 120");
    expect(src).toContain("mojibake_check.py");
    expect(src).toContain("git ls-files");
  });
});
