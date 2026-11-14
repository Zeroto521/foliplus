// Guard test for `script/check/form-class-literal.mjs` — the shared
// form-input class-name drift guard. The two FORM_CLASS tokens
// (`foliplus-input-skin`, `foliplus-form-select`) are a persisted DOM
// contract; a hand-spelled literal in production can drift from the
// vocabulary. This test pins the checker against the real tree (zero hits)
// and drives a synthetic red case to prove the guard can fail.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
  findBareFormClassLiterals,
  hasBareToken,
  main,
  runCli,
} from "#script/check/form-class-literal.mjs";

const REPO_ROOT = process.cwd();

describe("FORM_CLASS literals use the shared vocabulary", () => {
  it("keeps FORM_CLASS pinned to the two shared tokens", () => {
    const f = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "ui", "formClassName.ts"),
      "utf8",
    );
    expect(f).toMatch(/INPUT_SKIN: "foliplus-input-skin"/);
    expect(f).toMatch(/FORM_SELECT: "foliplus-form-select"/);
  });

  it(
    "finds no bare class literal in the production surface",
    { timeout: 60000 },
    () => {
      const hits = findBareFormClassLiterals(REPO_ROOT);
      expect(hits).toEqual([]);
    },
  );

  it("flags a synthetic hand-spelled literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      'const x = { class: "foliplus-input-skin" };\n',
    );
    const hits = findBareFormClassLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].file).toBe("foliplus/js/ui/bad.ts");
    expect(hits[0].line).toBe(1);
  });

  it("does not flag a longer class that merely starts with the token", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "ok.ts"),
      'const x = { class: "foliplus-input-skin-extra" };\n',
    );
    const hits = findBareFormClassLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("does not flag a data-* attribute value", () => {
    expect(
      hasBareToken('  data-layer="foliplus-input-skin"', "foliplus-input-skin"),
    ).toBe(false);
  });

  it("does not flag a CSS custom-property reference", () => {
    expect(
      hasBareToken("  color: var(--foliplus-input-skin);", "foliplus-input-skin"),
    ).toBe(false);
  });

  it("main exits 1 on a flagged synthetic tree (CLI semantics)", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      'const x = { class: "foliplus-input-skin" };\n',
    );
    const code = main(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it("main exits 0 on a clean synthetic tree (CLI semantics)", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "ok.ts"),
      "const x = { value: 1 };\n",
    );
    const code = main(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });

  it("runCli dispatch runs main when the entry matches the module (in-process)", () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "ok.ts"),
      "const x = { value: 1 };\n",
    );
    runCli([dir], __entryUrl);
    expect(process.exitCode).toBe(0);
    process.exitCode = prev;
    rmSync(dir, { recursive: true, force: true });
  });

  it("runCli dispatch is a no-op when the entry is not this module", () => {
    const prev = process.exitCode;
    process.exitCode = 42;
    runCli([process.cwd()], "C:/not/this/module.js");
    expect(process.exitCode).toBe(42);
    process.exitCode = prev;
  });

  it("tolerates a missing scan root", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    const missing = join(dir, "does-not-exist");
    const hits = findBareFormClassLiterals(missing);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("skips node_modules and non-ts files during the walk", () => {
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui", "node_modules"), {
      recursive: true,
    });
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "node_modules", "dep.ts"),
      'const x = { class: "foliplus-form-select" };\n',
    );
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "readme.md"),
      "foliplus-form-select\n",
    );
    const hits = findBareFormClassLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });
  it("main prints the real file:line, not the literal placeholder", () => {
    // Regression for the \${h.file} escape: the report must interpolate the
    // hit file, not print the template placeholder verbatim.
    const dir = mkdtempSync(join(tmpdir(), "form-class-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      'const x = { class: "foliplus-input-skin" };\n',
    );
    const log: string[] = [];
    const original = console.log;
    console.log = (...args) => {
      log.push(args.join(" "));
    };
    let code: number;
    try {
      code = main(dir);
    } finally {
      console.log = original;
      rmSync(dir, { recursive: true, force: true });
    }
    expect(code).toBe(1);
    expect(log.join("\n")).toContain("foliplus/js/ui/bad.ts:1");
    expect(log.join("\n")).not.toContain("${h.file}");
  });
});
