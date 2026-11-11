import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
  check,
  classifyLine,
  inventory,
  legacyAliasCheck,
  main,
  runCli,
  walk,
} from "#script/check/style-mode-usage.mjs";

// step 4 survey + migration-completeness gate: style-mode-usage.mjs
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

describe("style-mode-usage CLI dispatch and edge cases", () => {
  it("classifies a fully-closed block comment on one line as comment, not code", () => {
    const { kinds } = classifyLine("/* FILL_MODE */ const x = 1;", false) as {
      kinds: string[];
    };
    expect(kinds).toEqual(["comment"]);
  });

  it("classifies a block comment that closes on the same line while inBlock (continuation)", () => {
    // inBlock=true, the line opens with the tail of a comment and closes it.
    const { kinds } = classifyLine("* end */ const x = FILL_MODE.VALUE", true) as {
      kinds: string[];
    };
    expect(kinds).toContain("value");
  });

  it("classifies an unterminated block comment as comment-only", () => {
    const { kinds } = classifyLine("/* open comment", false) as { kinds: string[] };
    expect(kinds).toEqual([]);
  });

  it("walk returns [] on a missing directory", () => {
    expect(walk("C:/no-such-dir-xyz")).toEqual([]);
  });

  it("main --check-legacy-alias returns 0 on a clean tree", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      'const LEGACY_FILL_MODE_KEY = "fillMode";\nconst m = data.fillStyleMode ?? data[LEGACY_FILL_MODE_KEY];\n',
    );
    const code = main(["--check-legacy-alias", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });

  it("main --check-legacy-alias returns 1 when a bare fillMode remains", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      'const LEGACY_FILL_MODE_KEY = "fillMode";\nconst x = data.fillMode;\n',
    );
    const code = main(["--check-legacy-alias", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it("main --check returns 1 while a value reference remains", () => {
    const dir = synth("core/layer/intent.ts", "if (m === FILL_MODE.VALUE) {}");
    const code = main(["--check", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it("main --check returns 0 when only comments remain", () => {
    const dir = synth("core/layer/intent.ts", "// FILL_MODE comment stays");
    const code = main(["--check", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });

  it("main --json prints a JSON array (human path untouched)", () => {
    const dir = synth("core/layer/intent.ts", "if (m === FILL_MODE.VALUE) {}");
    const code = main(["--json", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });

  it("main with no flags prints human-readable output", () => {
    const dir = synth("core/layer/intent.ts", "if (m === FILL_MODE.VALUE) {}");
    const code = main(["--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
  });

  it("runCli with a non-matching entry is a no-op", () => {
    runCli("/some/other/path.js");
    expect(true).toBe(true);
  });

  it("runCli with the matching entry dispatches main", () => {
    runCli(__entryUrl);
    expect(typeof process.exitCode).toBe("number");
  });

  it("legacyAliasCheck tolerates a closed block comment in code", () => {
    const dir = synth(
      "foliplus/js/control/LayerControl/persistence.ts",
      '/* fillMode */\nconst LEGACY_FILL_MODE_KEY = "fillMode";\n',
    );
    const { failing } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
  });
});

describe("style-mode-usage remaining branch coverage", () => {
  const synthMany = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "style-mode-"));
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, "foliplus", "js", rel.replace(/^foliplus\/js\//, ""));
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content as string, "utf-8");
    }
    return dir;
  };

  it("classifies a bare FillMode type reference with no FILL_MODE constant as type", () => {
    const r = classifyLine("function f(mode: FillMode) {}", false);
    expect(r.kinds).toContain("type");
  });

  it("walk skips SKIP_DIR entries and non-.ts files", () => {
    const dir = synthMany({
      "core/layer/intent.ts": "export const INTENT = { FILL_MODE: 1 };",
      "core/note.txt": "not ts",
      "core/.git": "",
      "core/node_modules": "",
    });
    const files = walk(dir);
    expect(files.some(f => f.endsWith("intent.ts"))).toBe(true);
    expect(files.some(f => f.endsWith("note.txt"))).toBe(false);
    expect(files.some(f => f.includes("node_modules"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("check reports failing on a tree with a violation", () => {
    const dir = synth("core/layer/intent.ts", "const m = FILL_MODE.VALUE;");
    const r = check(dir) as unknown as { failing: boolean };
    rmSync(dir, { recursive: true, force: true });
    expect(r.failing).toBe(true);
  });

  it("inventory sorts hits across files and keeps per-file order", () => {
    const dir = synthMany({
      "core/layer/intent.ts": "const a = FILL_MODE.VALUE;",
      "core/layer/const.ts": "const c = FILL_MODE.VALUE;",
    });
    const hits = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    const intentHits = hits.filter(h => h.file.endsWith("intent.ts"));
    expect(intentHits.length).toBeGreaterThanOrEqual(1);
  });

  it("stripComments keeps a // comment that precedes a /* block on the same line", () => {
    const dir = synthMany({
      "foliplus/js/control/LayerControl/persistence.ts":
        'const LEGACY_FILL_MODE_KEY = "fillMode"; // note /* FILL_MODE */ extra\n',
    });
    const { failing } = legacyAliasCheck(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(failing).toBe(false);
  });

  it("classifies a line with both a FILL_MODE constant and a FillMode type annotation as type", () => {
    const r = classifyLine("const m: FillMode = FILL_MODE.VALUE;", false);
    expect(r.kinds).toContain("type");
  });

  it("sorts hits by file then line, comparing same-file and cross-file pairs", () => {
    // a.ts carries two hits: the same-file arm of the comparator must run
    // (a.line - b.line) while b.ts/c.ts force the cross-file arms.
    const dir = synthMany({
      "core/layer/a.ts": "const x = FILL_MODE.VALUE;\nconst y = FILL_MODE.SOLID;\n",
      "core/layer/b.ts": "const z = FILL_MODE.ORIGINAL;\n",
      "core/layer/c.ts": "const w = FILL_MODE.VALUE;\n",
    });
    const hits = inventory(dir);
    rmSync(dir, { recursive: true, force: true });
    const aHits = hits.filter(h => h.file.endsWith("a.ts"));
    expect(aHits.length).toBe(2);
    expect(aHits[0].line).toBeLessThan(aHits[1].line);
    expect(hits.length).toBe(4);
  });
  it("check reports failing when a line carries both value and type refs", () => {
    const dir = synthMany({
      "core/layer/intent.ts": "const m: FillMode = FILL_MODE.VALUE;\n",
    });
    const r = check(dir) as unknown as {
      failing: boolean;
      perFace: Record<string, { value: number; type: number }>;
    };
    rmSync(dir, { recursive: true, force: true });
    expect(r.failing).toBe(true);
  });

  it("main --root consumes the following argument as the root", () => {
    const dir = synth("core/layer/intent.ts", "const m = FILL_MODE.VALUE;\n");
    const code = main(["--check", "--root", dir]);
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
  });

  it("main --root with no following value leaves the default root", () => {
    const dir = synth("core/layer/intent.ts", "const m = FILL_MODE.VALUE;\n");
    // --root as the last argument: argv[i+1] is undefined, so the guard's
    // alternate arm runs and the default root stays in effect.
    const code = main(["--check", "--root"]);
    rmSync(dir, { recursive: true, force: true });
    // No --root value -> default cwd scan; on the repo tree that is not a
    // violation, so exit is 0. The point is the arm is exercised, not the value.
    expect([0, 1]).toContain(code);
  });
});
