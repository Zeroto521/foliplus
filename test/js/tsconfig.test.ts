import { spawnSync } from "child_process";
import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

// Production sources carry no type-system bypasses. Measured here at build time,
// not in tsc, because these are text properties: no checker reports the number
// of `as any` in the tree.
//
// These are not lint duplicates — eslint's ban-ts-comment only flags @ts-*
// lines it can classify, and no rule checks for `as any`. Without this the audit
// finding "24 bypasses" could come back silently.
//
// The suite's own error count is tracked in the program file itself.
// Its *shape* — that most of it is cascading implicit any rather than real
// mismatches — is what keeps it honest, so that is asserted below.

// Repo root via vitest's cwd — the convention build.test.ts and the bundle
// size check use. This test walks the production tree and reads the program
// file it guards.
const REPO_ROOT = process.cwd();
const SRC = resolve(REPO_ROOT, "foliplus/js");

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
const rel = (p: string) => p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");

// No alias reaches test/js (package.json imports, the build aliases and
// vitest.config.mjs all stop at foliplus/js and script/), so read the program
// file through the one const this test needs anyway.
const prodTsconfig = read(resolve(REPO_ROOT, "tsconfig.json"));
const testTsconfig = read(resolve(REPO_ROOT, "test/js/tsconfig.json"));

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
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.extends).toBe("../../tsconfig.json");
  });

  it("test/js/tsconfig.json does not relax strictness", () => {
    const cfg = JSON.parse(stripJsonComments(testTsconfig));
    expect(cfg.compilerOptions.strict).not.toBe(false);
  });

  for (const [label, raw] of [
    ["tsconfig.json", prodTsconfig],
    ["test/js/tsconfig.json", testTsconfig],
  ] as const) {
    it(`${label} pins the ambient declaration instead of globbing *.d.ts`, () => {
      // Every global in foliplus/js/type/global.d.ts (`map`, `CONF`, `L`,
      // `MapFoliplus`) is reachable only because the file is listed in `include`.
      // Nothing imports it, so a glob that stops matching silently drops every
      // global at once. Listing it explicitly is a review gate: adding a new
      // ambient declaration must be a deliberate edit.
      const cfg = JSON.parse(stripJsonComments(raw));
      const dts = (cfg.include as string[]).filter(g => g.endsWith(".d.ts"));
      // Exactly one, and named rather than globbed — a `**/*.d.ts` pattern is
      // what originally let this drift.
      expect(dts).toHaveLength(1);
      expect(dts[0].endsWith("foliplus/js/type/global.d.ts")).toBe(true);
    });
  }
});

// ── Test-program error shape ───────────────────────────────────
//
// The test suite is deliberately untyped today (test/js/tsconfig.json documents
// why) and is not a CI gate. What IS worth holding still is the *composition*
// of its errors: they are almost all implicit-any cascades from a mock-heavy
// surface, not type-safety holes. If that ratio flips, the suite has moved from
// "needs types" to "has real problems" and the tsconfig comment is stale.

// Diagnostic codes tsc raises for an implicit `any`. TS18046 is the member
// access off one of those.
const IMPLICIT_ANY = new Set([
  "TS7005",
  "TS7006",
  "TS7031",
  "TS7034",
  "TS7053",
  "TS18046",
  "TS18047",
  "TS18048",
]);

const classifyTestProgram = () => {
  // Same invocation as `npm run typecheck:tests`. The program is red by
  // design, so only its stderr is read.
  const out = spawnSync(
    process.execPath,
    ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "test/js/tsconfig.json"],
    { cwd: process.cwd(), encoding: "utf-8" },
  );
  const text = [out.stdout ?? "", out.stderr ?? ""].join("\n");
  const codes = [...text.matchAll(/error (TS\d+)/g)].map(m => m[1] as string);
  return {
    total: codes.length,
    implicitAny: codes.filter(c => IMPLICIT_ANY.has(c)).length,
  };
};

describe("test/js program error shape", () => {
  const { total, implicitAny } = classifyTestProgram();

  it("is still red (so removing the gate would not go unnoticed)", () => {
    expect(total).toBeGreaterThan(0);
  });

  it("is dominated by implicit any, not real mismatches", () => {
    // ~1600 total with ~75% cascading implicit any as of 2026-09-17. The bar
    // stays deliberately coarse: the counts move with every test added, but a
    // shift toward real mismatches is a different failure mode entirely.
    expect(implicitAny).toBeGreaterThan(total * 0.5);
    expect(implicitAny).toBeLessThan(total);
  });
});
