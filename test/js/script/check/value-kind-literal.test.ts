import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
  findBareValueKindLiterals,
  main,
  runCli,
} from "#script/check/value-kind-literal.mjs";

// VALUE_KIND literal drift guard: the by-value config kind is a persisted
// vocabulary — `kind: "numeric"` / `kind: "category"` select the ramp arms
// and are stored in the record, so they must never be spelled at a call site
// in a way that can drift from VALUE_KIND (core/value/valueKind.ts). A typo at a
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
// values (style-mode / icon-kind vocabularies). Whitelist: core/value/valueKind.ts
// (defines the constant).

const REPO_ROOT = process.cwd();

describe("value-kind literals use the VALUE_KIND constant", () => {
  it("keeps VALUE_KIND pinned to the persisted values", () => {
    const vk = readFileSync(
      resolve(REPO_ROOT, "foliplus", "js", "core", "value", "valueKind.ts"),
      "utf-8",
    );
    expect(vk).toMatch(/NUMERIC: "numeric"/);
    expect(vk).toMatch(/CATEGORY: "category"/);
  });

  it(
    "finds no bare kind literal in the production by-value surface",
    { timeout: 60000 },
    () => {
      const hits = findBareValueKindLiterals(REPO_ROOT);
      expect(hits).toEqual([]);
    },
  );

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
    mkdirSync(join(dir, "foliplus", "js", "core", "value"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "value", "valueKind.ts"),
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

  it('flags a synthetic element-access kind literal (x["kind"])', () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'if (cfg["kind"] === "category") {};\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("binary");
  });

  it("runCli dispatch runs main when the entry matches the module (in-process)", () => {
    const prev = process.exitCode;
    process.exitCode = 0;
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "ok.ts"),
      "const x = { value: 1 };\n",
    );
    // The script's own entry URL matches, so runCli takes its branch and calls main.
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

  it("does not flag a comparison on a non-kind variable", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "ok.ts"),
      'if (mode === "numeric") {};\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("flags a literal on the left side of a comparison", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "bad.ts"),
      'if ("category" === cfg.kind) {};\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("binary");
  });

  it("tolerates a missing scan root", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    const missing = join(dir, "does-not-exist");
    const hits = findBareValueKindLiterals(missing);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("skips node_modules and non-ts files during the walk", () => {
    const dir = mkdtempSync(join(tmpdir(), "value-kind-"));
    mkdirSync(join(dir, "foliplus", "js", "core", "layer", "node_modules"), {
      recursive: true,
    });
    mkdirSync(join(dir, "foliplus", "js", "core", "layer"), { recursive: true });
    // A literal inside node_modules must NOT be scanned.
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "node_modules", "dep.ts"),
      'const x = { kind: "numeric" };\n',
    );
    // A non-ts file in the tree is ignored.
    writeFileSync(
      join(dir, "foliplus", "js", "core", "layer", "readme.md"),
      'kind: "category"\n',
    );
    const hits = findBareValueKindLiterals(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });
});
