import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findBareValueKindLiterals, main } from "#script/check/value-kind-literal.mjs";

// VALUE_KIND literal drift guard: the by-value config kind is a persisted
// vocabulary — `kind: "numeric"` / `kind: "category"` select the ramp arms
// and are stored in the record, so they must never be spelled at a call site
// in a way that can drift from VALUE_KIND (core/valueKind.ts). A typo at a
// call site would silently misread or miswrite a persisted record.
//
// Scope: production `foliplus/js/**\*.ts` ONLY. Tests simulate persisted
// records with literals and are excluded. The guard detects the kind literals
// only in RUNTIME value positions (object property / comparison / nullish /
// switch case on a `.kind` discriminator), not in type positions (the
// ValueConfig discriminated-union contract).
//
// Exclusions (separate vocabularies): filterFeature.ts FieldKind
// (numeric/string/boolean — a FILTER field vocabulary), FILL_MODE / ICON_KIND
// values (style-mode / icon-kind vocabularies). Whitelist: core/valueKind.ts
// (defines the constant).

const REPO_ROOT = process.cwd();

describe("value-kind literals use the VALUE_KIND constant", () => {
  it("keeps VALUE_KIND pinned to the persisted values", () => {
    const vk = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "core", "valueKind.ts"),
      "utf-8",
    );
    expect(vk).toMatch(/NUMERIC: "numeric"/);
    expect(vk).toMatch(/CATEGORY: "category"/);
  });

  it("finds no bare kind literal in the production by-value surface", () => {
    const hits = findBareValueKindLiterals(REPO_ROOT);
    expect(hits).toEqual([]);
  });

  it("flags a synthetic property-assignment literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'const x = { kind: "numeric" };\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].context).toBe("property");
  });

  it("flags a synthetic comparison literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'if (cfg.kind === "category") {};\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("binary");
  });

  it("ignores a synthetic type-position literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "ok.ts"),
      'type V = { kind: "category" };\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("ignores a synthetic filterFeature FieldKind literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "filterFeature.ts"),
      'if (kind === "numeric") {};\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("ignores a synthetic whitelisted valueKind.ts literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "valueKind.ts"),
      'const VALUE_KIND = { NUMERIC: "numeric", CATEGORY: "category" };\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("flags a synthetic nullish fallback literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'const k = cfg.kind ?? "numeric";\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("binary");
  });

  it("flags a synthetic switch-case literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'switch (cfg.kind) { case "category": break; }\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("case");
  });

  it("ignores a comment mention of the literal", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "ok.ts"),
      '// kind: "category" is not a value here.\nconst x = 1;\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("main exits 1 on a flagged synthetic tree (CLI semantics)", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'const x = { kind: "numeric" };\n',
    );
    const code = main(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it("main exits 0 on a clean synthetic tree (CLI semantics)", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "ok.ts"),
      "const x = { value: 1 };\n",
    );
    const code = main(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });
});
