import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  findBareFilterSourceKeys,
  main,
  runCli,
  walk,
} from "#script/check/filter-source-key.mjs";

// A robust per-run scratch root: the OS temp dir when it resolves, else a
// repo-local scratch dir. (Some CI sandboxes omit TEMP/TMP, which makes
// os.tmpdir() return a non-existent path and every mkdtemp fail.)
const TMP_BASE =
  process.env.TEMP && existsSync(process.env.TEMP)
    ? process.env.TEMP
    : resolve(process.cwd(), ".foliplus", "tmp");
mkdirSync(TMP_BASE, { recursive: true });

// FILTER_SOURCE key drift guard: a surface's source name in the shared
// filterStore is a persistence key — the value is stored in the record and
// must never be spelled at the call site in a way that can drift from the
// constant. The well-known names live in FILTER_SOURCE (core/layer/filterStore.ts);
// a control with a fixed single surface (MeasureControl's type filter)
// references the constant, and a typo at a call site would silently create a
// second record entry or read an empty slot.
//
// Scope: MeasureControl (production + test) — the only control with a fixed
// single filter surface. HeatmapControl keys by a dynamic selected-layer id,
// so it has no fixed literal to pin. A control whose source name is a layer id
// in an event payload (LayerControl's mock `id: "measure"`) is NOT a
// filterStore source key and is outside this scope.
//
// The guard also pins the constant's value: FILTER_SOURCE.MEASURE must stay
// "measure" because that is the persisted record key — changing it would orphan
// every existing user's stored filter.

const REPO_ROOT = process.cwd();

describe("filter source keys use the FILTER_SOURCE constant", () => {
  it("keeps FILTER_SOURCE.MEASURE pinned to the persisted value", () => {
    const store = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "core", "layer", "filterStore.ts"),
      "utf-8",
    );
    expect(store).toMatch(/MEASURE: "measure"/);
  });

  it("finds no bare source-key string in the MeasureControl surface", () => {
    const hits = findBareFilterSourceKeys(REPO_ROOT);
    expect(hits).toEqual([]);
  });

  it("flags a synthetic bare literal", () => {
    // A synthetic root with a bare literal must be flagged.
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-key-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "bad.ts"),
      'const x = "measure";\n',
    );
    const hits = findBareFilterSourceKeys(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].text).toContain("measure");
  });
});

describe("walk() traversal", () => {
  it("returns [] for a target directory that does not exist", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-walk-"));
    const missing = join(dir, "no-such-dir");
    expect(walk(missing)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("recurses into subdirectories and collects only .ts/.tsx files", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-walk-"));
    mkdirSync(join(dir, "sub", "deep"), { recursive: true });
    writeFileSync(join(dir, "a.ts"), "export {};");
    writeFileSync(join(dir, "b.tsx"), "export {};");
    writeFileSync(join(dir, "skip.txt"), "not source");
    writeFileSync(join(dir, "skip.js"), "not scanned");
    writeFileSync(join(dir, "sub", "c.ts"), "export {};");
    writeFileSync(join(dir, "sub", "deep", "d.ts"), "export {};");
    const out = walk(dir)
      .map(f => f.split(/[\\/]/).pop())
      .sort();
    expect(out).toEqual(["a.ts", "b.tsx", "c.ts", "d.ts"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips SKIP_DIR entries (node_modules, dist, .git, ...) at any depth", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-walk-"));
    for (const skip of [
      "node_modules",
      "dist",
      ".venv",
      ".git",
      "coverage",
      ".agents",
    ]) {
      mkdirSync(join(dir, "control", skip), { recursive: true });
      writeFileSync(join(dir, "control", skip, "nested.ts"), "export {};");
    }
    mkdirSync(join(dir, "control", "real"), { recursive: true });
    writeFileSync(join(dir, "control", "real", "keep.ts"), "export {};");
    const out = walk(dir).map(f => f.split(/[\\/]/).pop());
    expect(out).toEqual(["keep.ts"]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("main() return codes", () => {
  it("returns 0 when no bare literal is present", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-main-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    mkdirSync(join(dir, "test", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "ok.ts"),
      "const x = FILTER_SOURCE.MEASURE;",
    );
    expect(main(dir)).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 1 and logs each hit when a bare literal is present", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-main-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    mkdirSync(join(dir, "test", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "bad.ts"),
      'const a = "measure";\nconst b = 2;',
    );
    writeFileSync(
      join(dir, "test", "js", "control", "MeasureControl", "bad2.ts"),
      'const c = "measure";',
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = main(dir);
    // Capture call data BEFORE mockRestore (vitest clears mock.calls on restore).
    const calls = spy.mock.calls.map(c => String(c[0]));
    const callCount = spy.mock.calls.length;
    spy.mockRestore();
    expect(code).toBe(1);
    expect(callCount).toBe(2);
    expect(calls[0]).toContain('bare "measure" literal');
    expect(calls[0]).toMatch(/bad\.ts:1:/);
    expect(calls[1]).toMatch(/bad2\.ts:1:/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("runCli() entry gating", () => {
  it("sets a non-zero exitCode when executed as the entry with hits", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-cli-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "bad.ts"),
      'const x = "measure";',
    );
    // Drive runCli directly with the SCRIPT's filesystem path as entry so the
    // guard (path.resolve(entry) === fileURLToPath(import.meta.url)) matches.
    const scriptPath = resolve(REPO_ROOT, "script", "check", "filter-source-key.mjs");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.exitCode;
    process.exitCode = 0;
    runCli([dir], scriptPath);
    // Capture exitCode + calls before mockRestore (vitest clears calls on restore).
    const exitAfter = process.exitCode;
    const callCount = spy.mock.calls.length;
    spy.mockRestore();
    expect(exitAfter).toBe(1);
    expect(callCount).toBe(1);
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not touch exitCode when the entry differs (imported, not executed)", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-cli-"));
    mkdirSync(join(dir, "foliplus", "js", "control", "MeasureControl"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "foliplus", "js", "control", "MeasureControl", "bad.ts"),
      'const x = "measure";',
    );
    // The test file is not the script entry, so the guard must not fire.
    const notEntry = resolve(
      REPO_ROOT,
      "test",
      "js",
      "script",
      "check",
      "filter-source-key.test.ts",
    );
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.exitCode;
    process.exitCode = 0;
    runCli([dir], notEntry);
    // Capture before mockRestore (vitest clears mock.calls on restore).
    const exitAfter2 = process.exitCode;
    const callCount2 = spy.mock.calls.length;
    spy.mockRestore();
    expect(exitAfter2).toBe(0);
    expect(callCount2).toBe(0);
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("treats an undefined entry as a no-op (imported by a test)", () => {
    const dir = mkdtempSync(join(TMP_BASE, "filter-source-cli-"));
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prev = process.exitCode;
    process.exitCode = 0;
    runCli([dir], undefined);
    spy.mockRestore();
    expect(process.exitCode).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });
});
