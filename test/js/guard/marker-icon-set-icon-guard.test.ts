// The marker-icon setIcon guard: every marker icon write must flow through
// the single whitelisted `setLeafIcon` call site in markerIcon.ts. A second
// direct `leaf.setIcon(` in production would let a caller rebuild the whole
// icon for what should be a paint-in-place update, silently re-introducing the
// DOM churn this dimension was made incremental to avoid. (A colour/opacity
// write paints the already-mounted inner nodes; only a glyph/prefix/structure
// change may rebuild.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");

// The one production file that may carry the direct marker-icon setIcon call,
// and the exact line that owns it — the setLeafIcon helper.
const SETICON_FILE = "foliplus/js/core/leaflet/markerIcon.ts";
const SETICON_OWNER = /const setLeafIcon =/;

// Walk .ts files under foliplus/js.
const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
};

// Strip comments so a doc comment that merely mentions setIcon cannot mask a
// real call.
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");

describe("marker icon writes flow through setLeafIcon", () => {
  it("forbids a direct leaf.setIcon( call outside the setLeafIcon owner line", () => {
    const hits: string[] = [];
    for (const file of walk(JS_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      const src = codeOnly(readFileSync(file, "utf8"));
      for (const [i, line] of src.split("\n").entries()) {
        if (/\bleaf\.setIcon\(/.test(line)) {
          if (rel !== SETICON_FILE) {
            hits.push(`${rel}:${i + 1}: ${line.trim()}`);
          } else {
            // Inside the owner file: the only direct call lives in the
            // setLeafIcon helper body. Locate the owner declaration line, then
            // scan from it for the first (only) direct leaf.setIcon( call.
            const lines = src.split("\n");
            const ownerIdx = lines.findIndex(l => SETICON_OWNER.test(l));
            const ownerCall = lines
              .slice(ownerIdx)
              .findIndex(l => /\bleaf\.setIcon\(/.test(l));
            if (i !== ownerIdx + ownerCall) {
              hits.push(`${rel}:${i + 1}: ${line.trim()}`);
            }
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
