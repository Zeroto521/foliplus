// The glyph prefix parameterization guard: the panel may render under any
// FontAwesome family a layer author declares (awesome-markers paints
// `prefix + " " + icon` verbatim), so the *author* prefix is deliberately
// free-form. But the PANEL's own default family must be single-sourced: the
// "fa-solid" literal may appear in foliplus/js production code ONLY on the
// GLYPH_PREFIXES.solid declaration line — everywhere else the family must flow
// from the parameter. A second hardcoded "fa-solid" would let a call site
// drift from the knob and silently re-introduce the original hardcoded
// behaviour.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GLYPH_PREFIXES } from "#core/leaflet/index.js";

const REPO_ROOT = process.cwd();
const JS_ROOT = resolve(REPO_ROOT, "foliplus", "js");

// The single file that may carry the "fa-solid" literal, and the exact line
// (after comment stripping) that owns it — the GLYPH_PREFIXES.solid value.
const PREFIX_TABLE_FILE = "foliplus/js/core/leaflet/glyphSource.ts";
const SOLID_DECLARATION = /solid:\s*"fa-solid"/;

// The generated modules carry the family from Python: config-schema.ts declares
// the `icon_prefix` union and config-default.ts carries its default value.
// Neither is a hand-written call site — the assertion below pins the generated
// default to GLYPH_PREFIXES.solid, so exempting them cannot let a second
// hardcoded family in.
const GENERATED_FILES = new Set([
  "foliplus/js/config-schema.ts",
  "foliplus/js/config-default.ts",
]);

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

// Strip comments (block + line) so a doc comment that merely mentions
// "fa-solid" cannot mask a real literal, and a real literal cannot hide in
// a comment.
const codeOnly = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\r\n]*/g, "");

describe("glyph prefix parameterization", () => {
  it("pins the fa-solid literal to the GLYPH_PREFIXES.solid declaration line (single source)", () => {
    const hits: string[] = [];
    for (const file of walk(JS_ROOT)) {
      const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
      if (GENERATED_FILES.has(rel)) continue;
      if (rel !== PREFIX_TABLE_FILE) {
        const src = codeOnly(readFileSync(file, "utf8"));
        if (/fa-solid/.test(src)) hits.push(rel);
        continue;
      }
      // Inside the prefix table file: after stripping comments, the literal may
      // appear ONLY on the GLYPH_PREFIXES.solid declaration line — a file-level
      // exemption would be too loose (a second literal anywhere in the file
      // would silently pass).
      const lines = codeOnly(readFileSync(file, "utf8")).split(/\r?\n/);
      const carrier = lines
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => /fa-solid/.test(line));
      expect(carrier.length).toBe(1);
      expect(carrier[0].line).toMatch(SOLID_DECLARATION);
    }
    expect(hits).toEqual([]);
  });

  it("keeps the generated icon_prefix default on the JS family single source", () => {
    // Python's `LayerControl.icon_prefix` default reaches the generated map
    // through the schema dump; it must be the same family the panel renders
    // under, not a value that merely happens to typecheck.
    const src = codeOnly(
      readFileSync(resolve(REPO_ROOT, "foliplus/js/config-default.ts"), "utf8"),
    );
    const match = src.match(/icon_prefix:\s*"([^"]+)"/);
    expect(match?.[1]).toBe(GLYPH_PREFIXES.solid);
  });
});
