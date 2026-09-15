import { readFileSync } from "fs";
import { resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const __dirname = resolve(fileURLToPath(import.meta.url), "../../../..");
const MAKEFILE = readFileSync(resolve(__dirname, "Makefile"), "utf-8").split("\n");

/** Index of a target's header line, or -1. Skips ``.PHONY``/``.DEFAULT`` entries. */
const at = (target: string): number => {
  const re = new RegExp(`^${target}:`);
  return MAKEFILE.findIndex(l => re.test(l) && !l.startsWith("."));
};

/** Pre-requisite names of a target, e.g. ``test-js:`` -> ``["build-js-dev"]``. */
const prereqs = (target: string): string[] => {
  const idx = at(target);
  expect(idx, `${target}:`).toBeGreaterThan(-1);
  return MAKEFILE[idx]
    .slice(target.length + 1)
    .split(":")[0]
    .split("\t")[0]
    .trim()
    .split(/\s+/)
    .filter(Boolean);
};

/** Recipe lines of a target. */
const recipe = (target: string): string[] => {
  const start = at(target) + 1;
  expect(start, `${target}:`).toBeGreaterThan(1);
  const out: string[] = [];
  for (let i = start; i < MAKEFILE.length; i += 1) {
    const line = MAKEFILE[i];
    if (line.startsWith("\t")) {
      out.push(line.trim());
      continue;
    }
    if (line.trim()) break;
  }
  return out;
};

/** Every target name and its recipe lines. */
const allTargets = (): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (let i = 0; i < MAKEFILE.length; i += 1) {
    const line = MAKEFILE[i];
    if (line.startsWith("\t")) continue;
    const name = line.split(":")[0].trim();
    if (!name) continue;
    const lines: string[] = [];
    for (let j = i + 1; j < MAKEFILE.length; j += 1) {
      if (MAKEFILE[j].startsWith("\t")) {
        lines.push(MAKEFILE[j].trim());
        continue;
      }
      if (MAKEFILE[j].trim()) break;
    }
    out.set(name, lines);
  }
  return out;
};

// ``foliplus/dist/`` is gitignored, so a fresh checkout has no build output and
// the artifact tests in build.test.ts cannot pass until it is built. The test
// targets therefore must not be runnable standalone without building first.
describe("test targets build before asserting on dist/", () => {
  it("dist is not tracked, so build output is never checked in", () => {
    const ignore = readFileSync(resolve(__dirname, ".gitignore"), "utf-8").split("\n");
    expect(ignore.some(l => l.replace(/\s/g, "") === "foliplus/dist/")).toBe(true);
  });

  it.each([["test"], ["test-python"], ["test-browser"], ["test-js"]])(
    "%s builds the JS bundle before running",
    target => {
      expect(prereqs(target)).toContain("build-js-dev");
    },
  );

  it.each([["test"], ["test-python"], ["test-browser"]])(
    "%s verifies the bundle is complete before running Python",
    target => {
      expect(recipe(target)).toContain("npm run build:verify");
    },
  );

  it("no target runs the JS suite without having built the bundle", () => {
    for (const [target, lines] of allTargets()) {
      if (lines.some(l => /^npm (test|run test)/.test(l))) {
        expect(
          prereqs(target),
          `${target} runs the JS suite but does not depend on build-js-dev`,
        ).toContain("build-js-dev");
      }
    }
  });

  it("build-js-dev writes the dev bundle the artifact tests assert on", () => {
    expect(recipe("build-js-dev")).toContain("npm run build:dev");
  });
});
