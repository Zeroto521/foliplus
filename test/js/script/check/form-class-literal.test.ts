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
});
