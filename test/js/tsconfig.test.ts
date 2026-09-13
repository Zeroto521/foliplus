import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// Production sources carry no type-system bypasses. Measured here at build time,
// not in tsc, because these are text properties: no checker reports the number
// of `as any` in the tree.
//
// These are not lint duplicates — eslint's ban-ts-comment only flags @ts-*
// lines it can classify, and no rule checks for `as any`. Without this the audit
// finding "24 bypasses" could come back silently.
//
// The test program's existence is what keeps this honest: a future author can
// relax strictness in tsconfig.test.json, but this file still forces strict to
// be on. The suite's own error count is tracked in the program file itself.

const ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
const SRC = resolve(ROOT, "foliplus/js");

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
};

const files = walk(SRC);
const read = (p: string) => readFileSync(p, "utf-8");
const rel = (p: string) => p.slice(ROOT.length + 1).replace(/\\/g, "/");

// tsconfig.json is JSON with comments (tsconfig's own dialect), which JSON.parse
// rejects. Strip line comments before parsing — the file carries no // inside
// a string value, so a per-line strip is exact here.
const stripJsonComments = (text: string): string =>
  text
    .split("\n")
    .map(line => {
      const i = line.indexOf("//");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n");

const BANNED: Array<{ name: string; re: RegExp }> = [
  { name: "`as any`", re: /\bas\s+any\b/g },
  { name: "`@ts-ignore`", re: /@ts-ignore/g },
  { name: "`@ts-expect-error`", re: /@ts-expect-error/g },
  { name: "`@ts-nocheck`", re: /@ts-nocheck/g },
];

describe("production type-system bypasses", () => {
  it("scans a non-trivial production tree", () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  for (const { name, re } of BANNED) {
    it(`contains no ${name}`, () => {
      const hits = files
        .map(f => ({ f, n: (read(f).match(re) || []).length }))
        .filter(x => x.n > 0);
      expect(hits, hits.map(h => `${rel(h.f)}: ${h.n}`).join("\n")).toEqual([]);
    });
  }

  it("test/js/tsconfig.json extends the production program", () => {
    const cfg = JSON.parse(
      stripJsonComments(readFileSync(resolve(ROOT, "test/js/tsconfig.json"), "utf-8")),
    );
    expect(cfg.extends).toBe("../../tsconfig.json");
  });

  it("test/js/tsconfig.json does not relax strictness", () => {
    const cfg = JSON.parse(
      stripJsonComments(readFileSync(resolve(ROOT, "test/js/tsconfig.json"), "utf-8")),
    );
    expect(cfg.compilerOptions.strict).not.toBe(false);
  });
});
