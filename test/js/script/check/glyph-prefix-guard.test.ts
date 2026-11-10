// The glyph prefix parameterization guard: the panel may render under any
// FontAwesome family a layer author declares (awesome-markers paints
// `prefix + " " + icon` verbatim), so the *author* prefix is deliberately
// free-form. But the PANEL's own default family must be single-sourced: the
// "fa-solid" literal may appear in foliplus/js production code only in the
// GLYPH_PREFIXES table — everywhere else the family must flow from the
// parameter. A second hardcoded "fa-solid" would let a call site drift from
// the knob and silently re-introduce the original hardcoded behaviour.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");

// Only the GLYPH_PREFIXES.solid value may carry the literal "fa-solid".
const ALLOWED = new Set([
  "foliplus/js/core/leaflet/glyphSource.ts",
]);

// Walk .ts files under foliplus/js, strip comments, find "fa-solid" literals.
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

// Crude comment stripper adequate for this guard: remove /* */ and // lines
// and quoted strings that are NOT the fa-solid literal.
const codeOnly = (src: string): string => {
  // strip block comments
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // strip line comments
  s = s.replace(/\/\/[^\r\n]*/g, "");
  return s;
};

describe("glyph prefix parameterization", () => {
  it("pins the fa-solid literal to the GLYPH_PREFIXES table (single source)", () => {
    const hits: string[] = [];
    for (const file of walk(JS_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (ALLOWED.has(rel)) continue;
      const src = codeOnly(readFileSync(file, "utf8"));
      if (/fa-solid/.test(src)) hits.push(rel);
    }
    expect(hits).toEqual([]);
  });

  it("keeps the default family constant pinned to fa-solid", () => {
    const gs = readFileSync(
      resolve(JS_ROOT, "core", "leaflet", "glyphSource.ts"),
      "utf-8",
    );
    expect(gs).toMatch(/solid: "fa-solid"/);
  });
});
