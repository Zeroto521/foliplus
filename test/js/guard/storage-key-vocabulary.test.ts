import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Storage-key suffix vocabulary guard: every persisted record key suffix must be
// a named STORAGE_SUFFIX constant (platform/storage.ts), never an inline literal
// passed to scopedStorageKey. A suffix spelled as a string at a call site can
// drift from the single source and silently create a second record. Only
// platform/storage.ts may define the suffix strings.

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");
const STORAGE_FILE = resolve(REPO_ROOT, "foliplus", "js", "platform", "storage.ts");

const SUFFIX_LITERALS = [
  "export_rect",
  "heatmap",
  "layer_state",
  "measure",
  "search",
  "filter_store",
  "layer_layout",
];

/** Walk foliplus/js (skipping runtime/type) recursively. */
const walkTs = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "runtime" || name === "type") continue;
      out.push(...walkTs(p));
    } else if (p.endsWith(".ts")) {
      out.push(p);
    }
  }
  return out;
};

/** Find a scopedStorageKey call whose suffix arg is a bare string literal. */
const findBareSuffixCalls = (src: string): { line: number; suffix: string }[] => {
  const out: { line: number; suffix: string }[] = [];
  const re = /scopedStorageKey\s*\(\s*[^,)]+\s*,\s*"([^"]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ line, suffix: m[1] });
  }
  return out;
};

/** Scan foliplus/js for bare-suffix scopedStorageKey calls outside storage.ts. */
const scanBareSuffixes = (root: string): string[] => {
  const files = walkTs(root);
  const violations: string[] = [];
  for (const file of files) {
    if (resolve(file) === STORAGE_FILE) continue;
    const src = readFileSync(file, "utf-8");
    const rel = file.slice(root.length).split(/[\\/]/).join("/");
    for (const hit of findBareSuffixCalls(src)) {
      violations.push(`${rel}:${hit.line}: scopedStorageKey(map, "${hit.suffix}") — use STORAGE_SUFFIX.${hit.suffix.toUpperCase()}`);
    }
  }
  return violations;
};

/** Confirm every SUFFIX_LITERALS value is defined in STORAGE_SUFFIX. */
const storageSrc = (): string => readFileSync(STORAGE_FILE, "utf-8");

describe("storage-key suffixes come from the single-source vocabulary", () => {
  it("defines every suffix in STORAGE_SUFFIX", () => {
    const src = storageSrc();
    for (const suffix of SUFFIX_LITERALS) {
      expect(src).toContain(suffix);
    }
  });

  it("finds no bare suffix literal passed to scopedStorageKey outside storage.ts", () => {
    expect(scanBareSuffixes(JS_ROOT)).toEqual([]);
  });

  it("rejects a synthetic bare suffix call (RED proof)", () => {
    const src = 'const k = scopedStorageKey(map, "export_rect");';
    const hits = findBareSuffixCalls(src);
    expect(hits).toHaveLength(1);
    expect(hits[0].suffix).toBe("export_rect");
    expect(findBareSuffixCalls('const k = scopedStorageKey(map, STORAGE_SUFFIX.EXPORT_RECT);')).toHaveLength(0);
  });
});
