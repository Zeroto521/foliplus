import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
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
    const hits = findOverlayContractViolations(REPO_ROOT);
    expect(hits).toEqual([]);
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
    expect(__entryUrl.endsWith("dropdown-overlay-guard.mjs")).toBe(true);
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
    expect(runCli([clean], undefined)).toBe(undefined); // entry mismatch -> no run
    const prev = process.exitCode;
    process.exitCode = undefined;
    try {
      runCli([clean], __entryUrl);
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
      runCli([dir], __entryUrl);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = prev;
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
