// test/js/guard/removed-api — retired public API names must stay retired.
//
// The #1344 red was not its own change: #1348 renamed the per-map hint surface
// from map.foliplus.showHint/hideHint/registerHintIcon to
// map.foliplus.hint.set/clear/registerIcon, migrated the mocks and most
// assertions, but left five showHint references in
// test/js/control/FullscreenControl/logic.test.ts. typecheck did not catch it
// because the map mock is any. The failure mode is one concept, two spellings,
// and no guard pinning the unique spelling.
//
// This guard scans foliplus/js/**/*.ts and test/js/**/*.ts for any retired
// public API name and fails on a hit, naming the replacement. It matches
// foliplus.<retired> member access and, where the old spelling was a bare
// call with no surviving export, <retired>( calls — in CODE only. Comment
// mentions and string literals are documentation/fixtures and stay legal.
//
// Any line that genuinely must use a retired name carries an adjacent
// // retired-api-exempt: <reason> comment naming why.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");
const TEST_ROOT = resolve(REPO_ROOT, "test/js");

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
  "__pycache__",
]);

/** One retired public API name. "member" means the retired spelling was a
 *  foliplus.<name> member (the bare module export may still be live, e.g.
 *  registerHintIcon); "call" means both member access and a bare name( call
 *  are dead (showHint/hideHint have no surviving export); "namespace" means
 *  the retired spelling is a foliplus.<name> namespace prefix. */
type Retired = {
  name: string;
  replacedBy: string;
  since: string;
  match: "member" | "call" | "namespace";
};

const RETIRED: readonly Retired[] = [
  { name: "showHint", replacedBy: "hint.set", since: "#1348", match: "call" },
  { name: "hideHint", replacedBy: "hint.clear", since: "#1348", match: "call" },
  { name: "registerHintIcon", replacedBy: "hint.registerIcon", since: "#1348", match: "member" },
  { name: "common", replacedBy: "platform", since: "#991", match: "namespace" },
  { name: "ui.index", replacedBy: "ui", since: "#991", match: "namespace" },
];

const EXEMPT_RE = /\/\/\s*retired-api-exempt:\s*\S+/;

/** Strip // and block comments and string literals from a line, returning the
 *  code part plus the block-comment carry state. Strings are dropped so a
 *  retired name inside a string (a fixture, a documentation mention) is not a
 *  call. */
function stripComments(line: string, inBlock: boolean): { code: string; inBlock: boolean } {
  let code = "";
  let inString: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (inBlock) {
      if (ch === "*" && next === "/") { inBlock = false; i++; }
      continue;
    }
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === "/" && next === "/") break;
    if (ch === "/" && next === "*") { inBlock = true; i++; continue; }
    if (ch === "'" || ch === '"') { inString = ch; continue; }
    code += ch;
  }
  return { code, inBlock };
}

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Scan one file's code (comments and string literals stripped) for retired
 *  names. Returns human-readable hits. Exported so the counter-proof can feed
 *  synthetic input without touching the tree. */
export function scanSource(text: string, rel: string): string[] {
  const hits: string[] = [];
  let inBlock = false;
  const lines = text.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    if (EXEMPT_RE.test(raw)) continue;
    const res = stripComments(raw, inBlock);
    inBlock = res.inBlock;
    const code = res.code;
    if (!code.trim()) continue;
    for (const r of RETIRED) {
      if (r.match === "namespace") {
        if (new RegExp(`\\bfoliplus\\.${r.name}\\b`).test(code)) {
          hits.push(`${rel}:${idx + 1}: retired namespace foliplus.${r.name} -> foliplus.${r.replacedBy} (${r.since})`);
        }
      } else {
        const member = new RegExp(`\\bfoliplus\\.${r.name}\\b`).test(code);
        const call = r.match === "call" && new RegExp(`\\b${r.name}\\s*\\(`).test(code);
        if (member || call) {
          hits.push(`${rel}:${idx + 1}: retired API ${r.name} -> ${r.replacedBy} (${r.since})`);
        }
      }
    }
  }
  return hits;
}

describe("retired public API names stay retired", () => {
  it("finds no retired API name in foliplus/js or test/js", () => {
    const files = [...walk(JS_ROOT, []), ...walk(TEST_ROOT, [])];
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      hits.push(...scanSource(readFileSync(file, "utf-8"), rel));
    }
    expect(hits).toEqual([]);
  });

  it("counter-proof: the scanner catches each retired spelling and spares the live one", () => {
    const cases: { text: string; hit: boolean; why: string }[] = [
      { text: "map.foliplus.showHint(key, text);", hit: true, why: "member access of showHint" },
      { text: "showHint(key, text);", hit: true, why: "bare showHint( call" },
      { text: "map.foliplus.hideHint(key);", hit: true, why: "member access of hideHint" },
      { text: "hideHint(key);", hit: true, why: "bare hideHint( call" },
      { text: "map.foliplus.registerHintIcon(name, svg);", hit: true, why: "retired per-map member" },
      { text: "registerHintIcon(name, svg);", hit: false, why: "bare registerHintIcon( is a live module export" },
      { text: "map.foliplus.hint.set(key, text, opts);", hit: false, why: "live replacement" },
      { text: "map.foliplus.hint.clear(key);", hit: false, why: "live replacement" },
      { text: "// map.foliplus.showHint is retired", hit: false, why: "comment mention is documentation" },
      { text: 'const s = "foliplus.showHint";', hit: false, why: "string literal is a fixture" },
      { text: "map.foliplus.showHint(k); // retired-api-exempt: legacy doc", hit: false, why: "exempt line" },
      { text: "window.foliplus.common.foo();", hit: true, why: "retired common namespace" },
      { text: "window.foliplus.ui.index.Slider;", hit: true, why: "retired ui.index namespace" },
      { text: "map.foliplus.platform.foo();", hit: false, why: "live platform namespace" },
    ];
    const failures = cases.filter(c => {
      const hits = scanSource(c.text, "synthetic.ts");
      return (hits.length > 0) !== c.hit;
    });
    expect(failures.map(f => f.why)).toEqual([]);
  });
});
