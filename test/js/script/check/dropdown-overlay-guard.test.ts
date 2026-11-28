import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canHoldViolation,
  findOverlayContractViolations,
  main,
  runCli,
  walk,
} from "#script/check/dropdown-overlay-guard.mjs";

// Overlay-contract guard: every createDropdown call in production must supply
// an `overlay` hook (the per-map registry's single Escape/outside-press
// dispatcher), and the overlay type must never be optional again — a missing
// hook would bind a second document keydown competing with the registry (the
// bug class #1011 and #1030 closed). The design also flattens the
// conditional-spread idiom into a direct property, so that idiom is flagged too.

const REPO_ROOT = process.cwd();

describe("createDropdown overlay contract", () => {
  it("finds no overlay violation in the production surface", { timeout: 60000 }, () => {
    const stats = { parsed: 0 };
    const hits = findOverlayContractViolations(REPO_ROOT, stats);
    expect(hits).toEqual([]);
    // Structural pin, not a wall clock: the gate's real cost is the number of
    // modules that reach ts.createSourceFile. 318 production modules today,
    // 10 pass the prefilter — a dozen is the budget with room for a new
    // createDropdown/overlay site, and a `prefilter: () => true` regression
    // jumps straight back to 318 and fails here. Wall-clock assertions on this
    // scan (0.2 s idle, 1.7–2.3 s on a shared host) would be load-flaky.
    expect(stats.parsed).toBeLessThanOrEqual(12);
  });

  it("flags a synthetic createDropdown call without overlay", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "const d = createDropdown({ items });\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].context).toBe("call");
  });

  it("accepts a synthetic createDropdown call with overlay", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "ok.ts"),
      "const d = createDropdown({ items, overlay });\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("flags a synthetic overlay?: optional property", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "interface Opts { overlay?: DropdownOverlay }\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("optional");
  });

  it("flags the synthetic conditional overlay spread", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "const o = { ...(x.overlay ? { overlay: x.overlay } : {}) };\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("spread");
  });

  it("skips the three declaration sites", () => {
    // The interfaces that DEFINE overlay as required live in dropdown.ts /
    // labelControl.ts / rampForm.ts — the guard must not flag the declaration.
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    mkdirSync(join(dir, "foliplus", "js", "core", "label"), { recursive: true });
    mkdirSync(join(dir, "foliplus", "js", "core", "value"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "dropdown.ts"),
      "interface DropdownOptions { overlay: DropdownOverlay }\n",
    );
    writeFileSync(
      join(dir, "foliplus", "js", "core", "label", "labelControl.ts"),
      "interface RenderLabelControlsOptions { overlay: DropdownOverlay }\n",
    );
    writeFileSync(
      join(dir, "foliplus", "js", "core", "value", "rampForm.ts"),
      "interface ClassesRowOptions { overlay: DropdownOverlay }\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits).toEqual([]);
  });

  it("pins the entry-url CLI contract (same as the other guards)", () => {
    // main() must exit 1 on a violation, 0 on clean — the CLI gate.
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "const d = createDropdown({ items });\n",
    );
    expect(main(dir)).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });
});

// The raw prefilter in findOverlayContractViolations is a superset of the AST
// rules, not a heuristic that decides them: issue #1427's review caught the
// first version silently dropping a comment-gapped `overlay /* gap */ ?` and a
// unicode-escaped `create\u0044ropdown`. These cases pin the superset, and the
// `//`-in-a-string case pins why the prefilter also checks the raw text (the
// shared comment stripper is line-based and can be fooled by a string).
describe("prefilter is a superset of the AST rules", () => {
  const scan = (content: string) => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(join(dir, "foliplus", "js", "ui", "probe.ts"), content);
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    return hits;
  };

  it("flags an overlay optional marker separated by a block comment", () => {
    const hits = scan("interface ProbeOpts { overlay /* gap */ ?: unknown }\n");
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("optional");
  });

  it("flags a createDropdown callee spelled with a unicode escape", () => {
    const hits = scan("const d = create\\u0044ropdown({ items });\n");
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("call");
  });

  it("flags an overlay identifier spelled with a unicode escape", () => {
    const hits = scan("interface ProbeOpts { \\u006Fverlay?: unknown }\n");
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("optional");
  });

  it("keeps the raw check when // inside a string swallows the rest of a line", () => {
    const hits = scan(
      'const url = "//"; interface ProbeOpts { overlay /* gap */ ?: unknown }\n',
    );
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("optional");
  });

  it("still skips a file with no overlay token at all", () => {
    const content = "const x = dropdown.create({ items });\n";
    // Assert the prefilter itself rejects it: "no hits" alone would also pass
    // with a prefilter that always returns true.
    expect(canHoldViolation(content)).toBe(false);
    expect(scan(content)).toEqual([]);
  });
});

describe("walk and CLI paths (coverage)", () => {
  it("walk returns empty for a missing directory", () => {
    expect(walk(join(tmpdir(), "overlay-guard-does-not-exist"))).toEqual([]);
  });

  it("walk collects only .ts files (a non-ts sibling is skipped)", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(join(dir, "foliplus", "js", "ui", "ok.ts"), "const x = 1;\n");
    writeFileSync(join(dir, "foliplus", "js", "ui", "skip.mjs"), "const y = 2;\n");
    const out = walk(join(dir, "foliplus", "js", "ui"));
    rmSync(dir, { recursive: true, force: true });
    expect(out.length).toBe(1);
    expect(out[0].endsWith("ok.ts")).toBe(true);
  });

  it("walk skips build and dependency directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    mkdirSync(join(dir, "foliplus", "js", "node_modules"), { recursive: true });
    mkdirSync(join(dir, "foliplus", "js", "dist"), { recursive: true });
    writeFileSync(join(dir, "foliplus", "js", "ui", "ok.ts"), "const x = 1;\n");
    writeFileSync(
      join(dir, "foliplus", "js", "node_modules", "pkg.ts"),
      "const y = 2;\n",
    );
    const out = walk(join(dir, "foliplus", "js"));
    rmSync(dir, { recursive: true, force: true });
    expect(out.length).toBe(1);
    expect(out[0].endsWith("ok.ts")).toBe(true);
  });

  it("does not flag a no-argument call (nothing to prove)", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "ok.ts"),
      "const d = createDropdown();\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(0);
  });

  it("flags a non-literal options object (cannot be proven)", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "const opts = { items };\nconst d = createDropdown(opts);\n",
    );
    const hits = findOverlayContractViolations(dir);
    rmSync(dir, { recursive: true, force: true });
    expect(hits.length).toBe(1);
    expect(hits[0].context).toBe("call");
  });

  it("runCli exits 0 on a clean tree and 1 on a violation", () => {
    const clean = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(clean, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(clean, "foliplus", "js", "ui", "ok.ts"),
      "const d = createDropdown({ items, overlay });\n",
    );
    expect(
      runCli([clean], undefined, resolve("script/check/dropdown-overlay-guard.mjs")),
    ).toBe(undefined); // entry mismatch -> no run
    const prev = process.exitCode;
    process.exitCode = undefined;
    try {
      runCli(
        [clean],
        resolve("script/check/dropdown-overlay-guard.mjs"),
        resolve("script/check/dropdown-overlay-guard.mjs"),
      );
      expect(process.exitCode).toBe(0); // clean tree -> exit 0 arm
    } finally {
      process.exitCode = prev;
    }
    rmSync(clean, { recursive: true, force: true });
  });

  it("runCli sets exit code for a violation when the entry matches", () => {
    const dir = mkdtempSync(join(tmpdir(), "overlay-guard-"));
    mkdirSync(join(dir, "foliplus", "js", "ui"), { recursive: true });
    writeFileSync(
      join(dir, "foliplus", "js", "ui", "bad.ts"),
      "const d = createDropdown({ items });\n",
    );
    const prev = process.exitCode;
    process.exitCode = undefined;
    try {
      runCli(
        [dir],
        resolve("script/check/dropdown-overlay-guard.mjs"),
        resolve("script/check/dropdown-overlay-guard.mjs"),
      );
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prev;
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
