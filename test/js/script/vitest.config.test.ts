/**
 * vitest.config.mjs coverage globs — dead config guard.
 *
 * test.include and coverage.include / coverage.exclude are glob lists with no
 * feedback loop: vitest silently accepts a glob that matches nothing, so a
 * wrong entry is invisible at runtime. The coverage.include entry for plain
 * .js sources had been dead since #122 and was only caught by running
 * coverage and diffing the tracked file count.
 *
 * This test re-derives the same question from the source tree and fails the
 * build when an entry stops meaning anything:
 *   - include glob matching 0 files  -> the extension no longer exists (dead)
 *   - exclude matching 0 files       -> typo, or the file was renamed/deleted
 *   - exclude also matching an include -> the entry was never active
 *
 * A coverage target nobody imported is NOT a defect (zero-hit files are
 * legitimate), so those are not reported here.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

// Repo root via vitest's cwd (the convention build.test.ts uses too).
const ROOT = process.cwd();
const configText = readFileSync(resolve(ROOT, "vitest.config.mjs"), "utf8").replace(
  /\r\n/g,
  "\n",
);

// The two include lists are the first and second occurrence of `include: [`.
const INCLUDES = pullList(configText, 0);
const COVERAGE_INCLUDES = pullList(configText, 1);
const EXCLUDES = pullList(configText, 0, "exclude");

/** TinyGlobby is what vitest's coverage globs run through, so reusing it here
 * keeps this test honest about globstar semantics (`**` does not match zero
 * path segments) instead of approximating them. */
const matchAll = (glob: string): string[] =>
  globSync({ cwd: ROOT, patterns: [glob], ignore: ["node_modules/**"] });

/** All quoted entries of the n-th occurrence of `<key>: [...]`. */
function pullList(text: string, occurrence: number, key = "include"): string[] {
  const marker = `${key}: [`;
  const indices: number[] = [];
  for (let i = 0; i < text.length - marker.length; i++) {
    if (text.slice(i, i + marker.length) === marker) indices.push(i);
  }
  expect(
    indices.length,
    `${key}: occurrence ${occurrence + 1} not found`,
  ).toBeGreaterThan(occurrence);
  const start = indices[occurrence];
  let depth = 0;
  let end = -1;
  for (let i = start + marker.length - 1; i < text.length; i++) {
    if (text[i] === "[") depth++;
    if (text[i] === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `${key}: unbalanced bracket`).toBeGreaterThanOrEqual(0);
  return [...text.slice(start + marker.length, end).matchAll(/"([^"]+)"/g)].map(
    m => m[1],
  );
}

describe("vitest.config.mjs", () => {
  it("test.include glob matches at least one test file", () => {
    const dead = INCLUDES.filter(glob => matchAll(glob).length === 0);
    expect(dead, "test.include glob matching no file — drop it or add tests").toEqual(
      [],
    );
  });

  it("coverage.include glob matches at least one source file", () => {
    const dead = COVERAGE_INCLUDES.filter(glob => matchAll(glob).length === 0);
    expect(
      dead,
      "coverage.include glob matching no file — the extension no longer exists",
    ).toEqual([]);
  });

  it("no coverage.include glob claims the same file twice", () => {
    const seen = new Map<string, string>();
    for (const glob of COVERAGE_INCLUDES) {
      for (const file of matchAll(glob)) {
        expect(
          seen.get(file),
          `${file} is claimed by both ${seen.get(file)} and ${glob}`,
        ).toBeUndefined();
        seen.set(file, glob);
      }
    }
  });

  it("coverage.exclude entries each remove a file the include globs would track", () => {
    const claimed = new Set<string>();
    for (const glob of COVERAGE_INCLUDES) {
      for (const file of matchAll(glob)) claimed.add(file);
    }

    const dead = EXCLUDES.filter(glob => {
      // Excluding a file no include glob tracks changes nothing.
      return !matchAll(glob).some(file => claimed.has(file));
    });
    expect(
      dead,
      "coverage.exclude entry removing no coverage target — typo, or the file was renamed",
    ).toEqual([]);
  });

  it("coverage.exclude has no duplicate entries", () => {
    const dupes = [...new Set(EXCLUDES.filter((e, i) => EXCLUDES.indexOf(e) !== i))];
    expect(dupes, "duplicate coverage.exclude entry").toEqual([]);
  });

  it("coverage.exclude per-control entries are globs, not literals", () => {
    // A literal path dies silently the moment a control grows its first module
    // subdir (LayerControl/ui.ts -> LayerControl/ui/*): the entry still looks
    // right, but it no longer excludes anything.
    // script/build.mjs is the intentional exception: one file, one role.
    const offenders = EXCLUDES.filter(
      glob => !glob.includes("*") && glob !== "script/build.mjs",
    );
    expect(
      offenders,
      "literal coverage.exclude entry — use a glob so a new subdir cannot silently become a coverage target",
    ).toEqual([]);
  });
});
