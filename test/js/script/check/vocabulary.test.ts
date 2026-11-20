// test/js/script/check/vocabulary — guard that LayerRole is the single word for the
// overlay/base grouping, with no `section` middle-layer.
//
// The user rule is "no section, one word role": a `section` identifier anywhere in
// foliplus/js or test/js is a regression toward the old vocabulary. Comments and
// CSS-class string literals are exempt (they are panel chrome or historical prose),
// as are RFC references and the persisted-record prose in persistence.ts.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = process.cwd();

// Identifiers that are NOT LayerRole section vocabulary (panel chrome / other concepts).
const ALLOWED_WORDS = new Set([
  "sectionDivider", // panel/form divider CSS class
  "SECTION_BLOCK", // heatmap section-block CSS class
  "SECTION_BLOCK_LAST",
  "STYLE_LABEL_SECTION", // style panel label section header CSS class
  "SECTION_DIVIDER", // panelClassName section-divider CSS class
  "sections", // legacy persisted v1 shape (legacy pre-rename shape)
]);

// Files/dirs exempt from the scan (documentation, history, locale).
const EXEMPT_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".agents"]);
// The guard must not scan itself: its own regex literals and string-stripping
// patterns leave a mangled `section` token after the crude comment/string strip.
const EXEMPT_FILES = new Set(["test/js/script/check/vocabulary.test.ts"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXEMPT_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|js)$/.test(entry.name)) yield full;
  }
}

function codeLines(src: string): string {
  // Strip comments and string literals crudely so only identifiers remain.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"([^"\\]|\\.)*"/g, '""')
    .replace(/'([^'\\]|\\.)*'/g, "''")
    .replace(/`[\s\S]*?`/g, "");
}

function collectWords(src: string): string[] {
  const cssClassLine = /foliplus-[a-z-]*s[e]ction[a-z-]*/;
  const srcLines = src.split("\n").filter(l => !cssClassLine.test(l));
  const body = codeLines(srcLines.join("\n"));
  const words = body.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
  return words.filter(w => /[Ss]ection/.test(w) && !ALLOWED_WORDS.has(w));
}

describe("vocabulary guard: no section middle-layer", () => {
  it("scans the tree for section identifiers", () => {
    const hits: string[] = [];
    const roots = [join(REPO_ROOT, "foliplus", "js"), join(REPO_ROOT, "test", "js")];
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (EXEMPT_FILES.has(rel)) continue;
        const src = readFileSync(file, "utf8");
        const words = collectWords(src);
        if (words.length > 0) {
          hits.push(`${rel}: ${[...new Set(words)].join(", ")}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("whitelist drift fails loudly", () => {
    // Every whitelisted word must actually occur in the scanned tree's raw
    // source. A whitelist entry that masks no occurrence is drift: it lets
    // the guard silently swallow a real regression, or is a stale entry that
    // should be removed. Adding a bogus entry to ALLOWED_WORDS fails this
    // loudly instead of passing silently.
    const roots = [join(REPO_ROOT, "foliplus", "js"), join(REPO_ROOT, "test", "js")];
    const seen = new Set<string>();
    for (const root of roots) {
      for (const file of walk(root)) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, "/");
        if (EXEMPT_FILES.has(rel)) continue;
        const src = readFileSync(file, "utf8");
        for (const w of ALLOWED_WORDS) {
          if (new RegExp(`\\b${w}\\b`).test(src)) seen.add(w);
        }
      }
    }
    const missing = [...ALLOWED_WORDS].filter(w => !seen.has(w));
    expect(
      missing,
      `whitelist entries masking no source occurrence (drift): ${missing.join(", ")}`,
    ).toEqual([]);
  });
});
