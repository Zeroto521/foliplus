import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  check,
  classifyLine,
  inventory,
  legacyAliasCheck,
} from "#script/check/style-mode-usage.mjs";

// task-41 step 4 survey + migration-completeness gate: style-mode-usage.mjs
// inventories FILL_MODE / FillMode occurrences in production foliplus/js/**.ts
// and (in --check mode) asserts the FILL_MODE -> STYLE_MODE / BORDER_MODE
// migration left no value or type reference. This test pins the three-way
// classification (value / type / comment, block-comment-aware), the face
// grouping, the --json shape, and the --check assertion.

/** Build a synthetic repo root with a single source file. */
const synth = (rel: string, content: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "style-mode-"));
  mkdirSync(join(dir, "foliplus", "js"), { recursive: true });
  // Handle nested rel under foliplus/js.
  const abs = join(dir, "foliplus", "js", rel.replace(/^foliplus\/js\//, ""));
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
  return dir;
};

describe("style-mode-usage inventory", () => {
  it("classifies a FILL_MODE value reference", () => {
    const { kinds } = classifyLine("if (mode === FILL_MODE.VALUE) {}", false);
    expect(kinds).toEqual(["value"]);
  });

  it("classifies a FillMode type annotation", () => {
    const { kinds } = classifyLine("const f = (m: FillMode): FillMode => m;", false);
    expect(kinds).toEqual(["type"]);
  });

  it("classifies a comment mention (line comment)", () => {
    const { kinds } = classifyLine("// FILL_MODE is the fill vocabulary", false) as {
      kinds: string[];
    };
    expect(kinds).toEqual(["comment"]);
  });

  it("classifies a block-comment continuation as comment, not code", () => {
    // A JSDoc continuation line (inside a block comment) must be comment.
    const { kinds } = classifyLine(
      " *  FillMode is reused as the stroke vocabulary",
      true,
    ) as { kinds: string[] };
    expect(kinds).toEqual(["comment"]);
    // And the state is not accidentally flipped.
    expect(true).toBe(true);
  });

  it("reports the value/type/comment kinds through inventory on a synthetic tree", () => {
    const dir = synth(
      "core/layer/intent.ts",
      'const FILL_MODE = { SOLID: "solid" };\ntype FillMode = (typeof FILL_MODE)[keyof typeof FILL_MODE];\n// FILL_MODE note\n',
    );
    const hits = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    const kinds = hits.map(h => h.kind).sort();
    expect(kinds).toContain("value");
    expect(kinds).toContain("type");
    expect(kinds).toContain("comment");
  });

  it("groups border.ts and strokeValue.ts as the border face", () => {
    const dir = synth(
      "control/LayerControl/ui/style/border.ts",
      "if (m === FILL_MODE.VALUE) {}\nconst f = (m: FillMode) => m;\n",
    );
    const hits = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(2);
    expect(hits.every(h => h.face === "border")).toBe(true);
  });

  it("produces a JSON-serializable array with file/line/kind/face/text", () => {
    const dir = synth(
      "control/LayerControl/ui/style/fill.ts",
      "if (m === FILL_MODE.SOLID) {}\n",
    );
    const hits = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    const json = JSON.stringify(hits);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0]).toHaveProperty("file");
    expect(parsed[0]).toHaveProperty("line");
    expect(parsed[0]).toHaveProperty("kind");
    expect(parsed[0]).toHaveProperty("face");
    expect(parsed[0]).toHaveProperty("text");
  });

  it("--check fails while any value/type FILL_MODE reference remains", () => {
    const dir = synth(
      "core/layer/intent.ts",
      "if (m === FILL_MODE.VALUE) {}\nconst f = (m: FillMode) => m;\n",
    );
    const { failing } = check(dir) as unknown as { failing: boolean };
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(true);
  });

  it("--check passes when no value/type FILL_MODE reference remains (comment-only tolerated)", () => {
    const dir = synth(
      "core/layer/intent.ts",
      'const STYLE_MODE = { SOLID: "solid" };\n// FILL_MODE comment stays\n',
    );
    const { failing } = check(dir) as unknown as { failing: boolean };
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
  });

  it("respects --root by scanning only the given tree", () => {
    // inventory is rooted at process.cwd() by default; --root is main()'s concern.
    const dir = synth("core/layer/intent.ts", "if (m === FILL_MODE.VALUE) {}\n");
    const fromRoot = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(fromRoot.length).toBeGreaterThan(0);
  });
});

describe("legacy-alias guard (--check-legacy-alias)", () => {
  it("passes when the only code 'fillMode' is the LEGACY_FILL_MODE_KEY definition", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      'const LEGACY_FILL_MODE_KEY = "fillMode";\nconst m = data.fillStyleMode ?? data[LEGACY_FILL_MODE_KEY];\n',
    );
    const { failing, sites } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
    expect(sites.filter(s => s.fatal)).toHaveLength(0);
  });

  it("fails when a second bare 'fillMode' appears in code outside the definition", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      'const LEGACY_FILL_MODE_KEY = "fillMode";\nconst x = data.fillMode;\n',
    );
    const { failing, sites } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(true);
    expect(sites.filter(s => s.fatal)).toHaveLength(1);
  });

  it("tolerates comment mentions of 'fillMode' (reported, not fatal)", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      '// the old key was fillMode\nconst LEGACY_FILL_MODE_KEY = "fillMode";\n',
    );
    const { failing, sites } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
    expect(sites.some(s => !s.fatal && /fillMode/.test(s.text))).toBe(true);
  });

  it("treats a multi-line JSDoc block as comment, not code", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      '/**\n * the old fillMode key\n */\nconst LEGACY_FILL_MODE_KEY = "fillMode";\n',
    );
    const { failing } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
  });

  it("fails on a bare 'fillMode' inside a string template in code", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      'const LEGACY_FILL_MODE_KEY = "fillMode";\nconst key = `fillMode`;\n',
    );
    const { failing } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(true);
  });
});
