import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Per-map storage-key scope guard: every persisted record key must derive from
// map.getContainer().id, so multi-map pages keep state separate. The single source
// is scopedStorageKey (platform/storage.ts); folderLayoutKey / filterStoreKey and
// the per-component STORAGE_KEY constants all route through it. A new key written
// as a bare `foliplus_*` literal (no map scope) is a regression this guard rejects.

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");

const SCOPED_CALL = /\b(?:scopedStorageKey|folderLayoutKey|filterStoreKey|orderKeyOf)\s*\(/;
// A hand-rolled `foliplus_*_${map.getContainer().id}` template is NOT scoped: it
// re-derives the key shape by hand instead of asking the single source, so a
// suffix/separator typo silently creates a second record. Only the
// scopedStorageKey call (and its three named wrappers: folderLayoutKey,
// filterStoreKey, orderKeyOf) counts.
const IS_SCOPED_RHS = (rhs: string): boolean => SCOPED_CALL.test(rhs);

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

type Import = { ns: string | null; names: string[]; path: string };
type Call = { line: number; keyArg: string };

/** Resolve a relative import spec to a real module path (.js spec -> .ts file). */
const resolveImportPath = (from: string, spec: string): string => {
  let abs = resolve(dirname(from), spec);
  if (abs.endsWith(".js")) {
    const ts = `${abs.slice(0, -3)}.ts`;
    if (statSync(ts, { throwIfNoEntry: false })) abs = ts;
  }
  return abs;
};

/** Parse relative imports: `import * as NS from \"...\"` and `import { A } from \"...\"`. */
const parseImports = (src: string, filePath: string): Import[] => {
  const imports: Import[] = [];
  const re =
    /import\s+(?:\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+|\{([^}]*)\}\s+from\s+)(["'][^"']+["'])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const spec = m[3].replace(/^["']|["']$/g, "");
    if (!spec.startsWith(".")) continue;
    const path = resolveImportPath(filePath, spec);
    if (m[1]) imports.push({ ns: m[1], names: [], path });
    else if (m[2]) {
      imports.push({
        ns: null,
        names: m[2]
          .split(",")
          .map(s =>
            s
              .trim()
              .split(/\s+as\s+/)[0]
              .trim(),
          )
          .filter(Boolean),
        path,
      });
    }
  }
  return imports;
};

/** Collect scoped chains defined in a module (line-scoped, allows leading ws + multi-line objects). */
const scopedChainsIn = (src: string): Set<string> => {
  const chains = new Set<string>();
  const lines = src.split("\n");
  const declarationRe =
    /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);?\s*(?:\/\/.*)?$/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = declarationRe.exec(line);
    if (!m) continue;
    const name = m[1];
    const rhs = m[2];
    if (IS_SCOPED_RHS(rhs)) chains.add(name);
    const objRe = /\{\s*([A-Za-z_$][\w$]*)\s*:\s*([^}]+?)\s*[,}]/g;
    let om: RegExpExecArray | null;
    while ((om = objRe.exec(rhs)) !== null) {
      if ((om[1] === "KEY" || om[1] === "STORAGE_KEY") && IS_SCOPED_RHS(om[2])) {
        chains.add(`${name}.${om[1]}`);
      }
    }
    // Multi-line object literal: `const HISTORY = {` ... closing `}` on a later line.
    if (/^\s*(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*\{\s*$/.test(line)) {
      let body = "";
      let j = i + 1;
      for (; j < lines.length; j++) {
        body += `${lines[j]}\n`;
        if (lines[j].includes("}")) break;
      }
      const memRe = /\b(KEY|STORAGE_KEY)\s*:\s*([^,}]+)/g;
      let mm: RegExpExecArray | null;
      while ((mm = memRe.exec(body)) !== null) {
        if (IS_SCOPED_RHS(mm[2])) chains.add(`${name}.${mm[1]}`);
      }
    }
  }
  return chains;
};

/** Split a call args on top-level commas, return the first. */
const firstArg = (src: string, openIdx: number): string => {
  let depth = 0;
  for (let i = openIdx + 1; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return src.slice(openIdx + 1, i).trim();
      depth--;
    } else if (ch === "," && depth === 0) {
      return src.slice(openIdx + 1, i).trim();
    }
  }
  return src.slice(openIdx + 1).trim();
};

/** The wrapper implementation is the one module allowed to touch localStorage:
 *  every other module must route its keys through platform/storage. */
const isStorageImplFile = (filePath: string): boolean =>
  filePath.replace(/\\/g, "/").endsWith("platform/storage.ts");

/** Find storage call sites and their FIRST key argument (skips platform/storage.ts). */
const findStorageCalls = (src: string, filePath: string): Call[] => {
  if (isStorageImplFile(filePath)) return [];
  const calls: Call[] = [];
  const re =
    /\b(?:loadRecord|saveRecord|loadVersioned|saveVersioned|removeRecord)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const prefix = src.slice(Math.max(0, m.index - 40), m.index);
    if (
      /const\s+(?:loadRecord|saveRecord|loadVersioned|saveVersioned|removeRecord)\s*=/.test(
        prefix,
      )
    ) {
      continue;
    }
    const openIdx = src.indexOf("(", m.index);
    const keyArg = firstArg(src, openIdx);
    const line = src.slice(0, m.index).split("\n").length;
    calls.push({ line, keyArg });
  }
  return calls;
};

type BareCall = { line: number; arg: string };

/** Find bare window.localStorage.(get|set|remove)Item call sites.
 *
 * platform/storage.ts owns the wrapper and is the only module allowed to reach
 * localStorage itself; any other module writing a key straight through it would
 * silently skip the map-scope contract, so it is reported as a violation.
 */
const findBareLocalStorage = (src: string, filePath: string): BareCall[] => {
  if (isStorageImplFile(filePath)) return [];
  const out: BareCall[] = [];
  const re = /\.localStorage\s*\.\s*(?:get|set|remove)Item\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const openIdx = src.indexOf("(", m.index);
    const line = src.slice(0, m.index).split("\n").length;
    out.push({ line, arg: firstArg(src, openIdx) });
  }
  return out;
};

/** Resolve a key arg to scoped status. */
const isScopedArg = (
  arg: string,
  chains: Set<string>,
  imports: Import[],
  chainByModule: Map<string, Set<string>>,
): boolean => {
  if (SCOPED_CALL.test(arg)) return true;
  // A literal (string or template) cannot ask scopedStorageKey, so a hand-rolled
  // `foliplus_*_${map.getContainer().id}` key is a violation by definition.
  if (arg.startsWith('"') || arg.startsWith("`")) return false;
  const parts = arg.split(".").filter(Boolean);
  const chain = parts.join(".");
  if (chains.has(chain)) return true;
  for (const imp of imports) {
    const modChains = chainByModule.get(imp.path);
    if (!modChains) continue;
    if (imp.ns === parts[0]) {
      const sub = parts.slice(1).join(".");
      if (sub && modChains.has(sub)) return true;
    }
    if (parts.length >= 2 && imp.names.includes(parts[0])) {
      if (modChains.has(chain)) return true;
    }
    if (parts.length === 1 && imp.names.includes(chain) && modChains.has(chain)) {
      return true;
    }
  }
  return false;
};

/** Run both scans over one tree and return every violation as `relpath:line: detail`. */
const scanViolations = (root: string): string[] => {
  const files = walkTs(root);
  const chainByModule = new Map<string, Set<string>>();
  for (const file of files) {
    chainByModule.set(file, scopedChainsIn(readFileSync(file, "utf-8")));
  }
  const violations: string[] = [];
  for (const file of files) {
    const rel = file.slice(root.length).split(/[\\/]/).join("/");
    const src = readFileSync(file, "utf-8");
    const imports = parseImports(src, file);
    for (const call of findStorageCalls(src, file)) {
      if (!isScopedArg(call.keyArg, chainByModule.get(file)!, imports, chainByModule)) {
        violations.push(`${rel}:${call.line}: ${call.keyArg}`);
      }
    }
    for (const bare of findBareLocalStorage(src, file)) {
      violations.push(`${rel}:${bare.line}: bare localStorage access (${bare.arg})`);
    }
  }
  return violations;
};

describe("storage keys are scoped to the map container", () => {
  it("every storage key and every localStorage access routes through platform/storage", () => {
    expect(scanViolations(JS_ROOT)).toEqual([]);
  });

  it("rejects a module that reaches localStorage outside the wrapper", () => {
    const root = mkdtempSync(join(tmpdir(), "foliplus-storage-guard-"));
    try {
      mkdirSync(join(root, "js", "platform"), { recursive: true });
      mkdirSync(join(root, "js", "leaky"), { recursive: true });
      // The wrapper itself may touch localStorage - it is exempt.
      writeFileSync(
        join(root, "js", "platform", "storage.ts"),
        "export const read = (k: string) => window.localStorage.getItem(k);\n",
      );
      // A module that skips the wrapper and writes a key straight through it
      // bypasses the map scope entirely - the guard must name it.
      writeFileSync(
        join(root, "js", "leaky", "cache.ts"),
        "// leaky/cache - scratch read-through cache.\n" +
          'const GHOST = "foliplus_layer_layout";\n' +
          "export const peek = (): string | null =>\n" +
          "  window.localStorage.getItem(GHOST);\n",
      );
      const found = scanViolations(join(root, "js"));
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("cache.ts:");
      expect(found[0]).toContain("leaky");
      expect(found[0].endsWith("bare localStorage access (GHOST)")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a deliberate global key (synthetic RED proof)", () => {
    const chains = new Set<string>();
    const empty = new Map<string, Set<string>>();
    expect(isScopedArg('"foliplus_layer_layout"', chains, [], empty)).toBe(false);
    expect(isScopedArg('"foliplus_filter_store"', chains, [], empty)).toBe(false);
    expect(isScopedArg('scopedStorageKey(map, "layer_state")', chains, [], empty)).toBe(
      true,
    );
    expect(isScopedArg('"foliplus_x_abc"', chains, [], empty)).toBe(false);
    expect(
      isScopedArg("`foliplus_x_${map.getContainer().id}`", chains, [], empty),
    ).toBe(false);
    // The hand-rolled template that used to pass IS_SCOPED_RHS must fail: it
    // bypasses the single source and can drift from `foliplus_<suffix>_<mapId>`.
    expect(
      isScopedArg("`foliplus_heatmap_${map.getContainer().id}`", chains, [], empty),
    ).toBe(false);
  });
});
