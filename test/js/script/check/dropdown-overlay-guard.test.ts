import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  __entryUrl,
  findOverlayContractViolations,
  main,
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
