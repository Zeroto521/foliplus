import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import setupFixture from "#script/conf-fixture-setup.mjs";

// The fixture is generated from foliplus/_schema.py, so a stale committed copy
// silently mismatches the schema. Every vitest entry point must therefore
// regenerate it before any test runs — hence a globalSetup rather than an npm
// `pretest` hook, which only covers `npm test`.

// Repo root via vitest's cwd (the convention build.test.ts uses too).
const ROOT = process.cwd();
const FIXTURE = resolve(ROOT, "test", "js", "conf-fixture.ts");
const configText = readFileSync(resolve(ROOT, "vitest.config.mjs"), "utf8").replace(
  /\r\n/g,
  "\n",
);
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

describe("conf-fixture-setup", () => {
  it("is wired as the vitest globalSetup and not to an npm pretest hook", () => {
    expect(configText).toMatch(/globalSetup:\s*\[\s*"script\/conf-fixture-setup\.mjs"/);
    expect(pkg.scripts.pretest).toBeUndefined();
  });

  it("runs the generator and leaves the committed fixture unchanged", () => {
    const committed = readFileSync(FIXTURE, "utf8");
    expect(committed).toContain("function makeConf(");

    // No throw, and the committed file is byte-identical afterwards: the
    // generator reproduces exactly what is committed.
    setupFixture();
    expect(readFileSync(FIXTURE, "utf8")).toBe(committed);
  });
});
