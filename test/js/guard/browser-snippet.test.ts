// test/js/guard/browser-snippet — the browser probe library stays whole:
// every snippet is cited by a consumer, and no two snippets are copies.
//
// test/js/browser/**/*.js is a corpus, not a test tree: each file is a
// JavaScript payload a Python Playwright test injects as
// page.evaluate(_js("LayerControl/read_layer_items")). Two drifts are silent
// without a guard:
//
//   1. an orphan — a snippet no consumer cites. It looks like coverage (a file
//      in the corpus) but no browser run ever executes it. The probe gate
//      (script/check/browser-probe.mjs) reports orphans, but only as an
//      informational number in its report; this guard makes the same signal a
//      hard failure in the normal vitest run.
//   2. a duplicate — two snippets with the same body under different names.
//      That is the same script kept twice: an edit lands in one copy, and the
//      other silently restores the old behaviour for the tests that cite it.
//
// Support files (a _-prefixed basename, e.g. _parse_probe.js) are helpers the
// probe gate already excludes from the probe inventory, so they owe no
// reference; they still owe a unique body.
//
// Teeth: orphans() and duplicateGroups() are pure over an injected list, and
// the cases below feed them an uncited snippet and a whitespace-only copy. A
// relaxation into a prefix match or a shape-only comparison turns the
// real-corpus assertions green while these stay red.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");
const SNIPPET_DIR = resolve(ROOT, "test/js/browser");

// Every tree a snippet can be cited from. Browser tests cite a probe by name
// through _js("…"); the other two are where a shared harness or a probe gate
// would name one.
const CONSUMER_DIRS = [
  resolve(ROOT, "test/python"),
  resolve(ROOT, "test/js"),
  resolve(ROOT, "script"),
];
const CONSUMER_EXTENSIONS = [".py", ".ts", ".mjs"] as const;

// One quoted string literal per match: single- or double-quoted, single line.
const QUOTED_RE = /"([^"\n]*)"|'([^'\n]*)'/g;

/** Every regular file below `dir`, recursively (absolute paths). */
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

/** Snippet name: the path below test/js/browser, minus the .js extension. */
const snippetName = (abs: string): string =>
  relative(SNIPPET_DIR, abs).split(sep).join("/").replace(/\.js$/, "");

const snippetPaths = (): string[] =>
  walk(SNIPPET_DIR)
    .filter(abs => abs.endsWith(".js"))
    .sort();

/** Support file: a _-prefixed basename — the browser-probe.mjs rule. */
const isSupportSnippet = (name: string): boolean =>
  name.split("/").pop()!.startsWith("_");

const consumerFiles = (): string[] =>
  CONSUMER_DIRS.flatMap(dir =>
    walk(dir).filter(abs => CONSUMER_EXTENSIONS.some(ext => abs.endsWith(ext))),
  );

/** Every quoted literal in the consumer trees, one set for the whole corpus. */
const citedNames = (files: string[]): Set<string> => {
  const out = new Set<string>();
  for (const abs of files) {
    const src = readFileSync(abs, "utf8");
    for (const match of src.matchAll(QUOTED_RE)) {
      out.add(match[1] ?? match[2]);
    }
  }
  return out;
};

/** Names no consumer cites; support files never owe a citation. */
const orphans = (names: string[], cited: Set<string>): string[] =>
  names.filter(name => !isSupportSnippet(name) && !cited.has(name));

type Snippet = { name: string; body: string };

const normalize = (src: string): string => src.replace(/\s+/g, " ").trim();

const loadSnippet = (abs: string): Snippet => ({
  name: snippetName(abs),
  body: readFileSync(abs, "utf8"),
});

/** Name groups that share one body once whitespace is normalised. */
const duplicateGroups = (snippets: Snippet[]): string[][] => {
  const byBody = new Map<string, string[]>();
  for (const { name, body } of snippets) {
    const key = normalize(body);
    const names = byBody.get(key) ?? [];
    names.push(name);
    byBody.set(key, names);
  }
  return [...byBody.values()]
    .filter(names => names.length > 1)
    .map(names => names.sort());
};

describe("browser snippet library", () => {
  it("every snippet is cited by a consumer", () => {
    const names = snippetPaths().map(snippetName);
    expect(names.length, "no browser snippets found").toBeGreaterThan(0);

    const cited = citedNames(consumerFiles());
    // An empty citation set would make every snippet look orphaned; guard the
    // scanner itself before reading the orphan list as a corpus fact.
    expect(
      cited.size,
      "no quoted literals found in the consumer trees",
    ).toBeGreaterThan(0);

    const found = orphans(names, cited);
    expect(
      found,
      `orphan browser snippets (no consumer cites the name): ${found.join(", ")}`,
    ).toEqual([]);
  });

  it("no two snippets share one body", () => {
    const snippets = snippetPaths().map(loadSnippet);
    expect(snippets.length, "no browser snippets found").toBeGreaterThan(0);

    const groups = duplicateGroups(snippets);
    const rendered = groups.map(names => names.join(" == "));
    expect(
      rendered,
      `duplicate browser snippets (same body, two names): ${rendered.join("; ")}`,
    ).toEqual([]);
  });
});

describe("browser snippet guard teeth", () => {
  it("flags an uncited snippet but never a support file", () => {
    const names = [
      "LayerControl/synthetic_orphan",
      "_parse_probe",
      "LayerControl/synthetic_cited",
    ];
    expect(orphans(names, new Set(["LayerControl/synthetic_cited"]))).toEqual([
      "LayerControl/synthetic_orphan",
    ]);
  });

  it("flags a copy that differs only in whitespace, not a distinct script", () => {
    const snippets = [
      { name: "A/one", body: "() => { const x = 1; };" },
      { name: "B/two", body: "() => {\n  const x = 1;\n};\n" },
      { name: "C/three", body: "() => { const x = 2; };" },
    ];
    expect(duplicateGroups(snippets)).toEqual([["A/one", "B/two"]]);
  });
});
