import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { findConvergenceViolations } from "#script/check/replay-convergence.mjs";

// LayerControl replay-path convergence guard (replay convergence): the two registration
// paths (construction-seeded A path and layeradd/registerLayer B path) must
// call ONLY the single replay entries — replayStoredState / replayStoredStateAll
// — never the per-dimension replay functions directly. A new dimension added to
// one path but not the other recreates the #1181 class of bug (a seed layer
// dropping its stored filter). The dimension functions are sanctioned only
// inside the entries and the applyUserState style-dims helper.

const REPO_ROOT = process.cwd();
const TMP_BASE =
  process.env.TEMP && existsSync(process.env.TEMP)
    ? process.env.TEMP
    : resolve(process.cwd(), ".foliplus", "tmp");

describe("LayerControl replay paths converge on one entry", () => {
  it("finds no direct dimension-replay call outside the sanctioned bodies", () => {
    const hits = findConvergenceViolations(REPO_ROOT);
    expect(hits).toEqual([]);
  });

  it("flags a synthetic direct replayFilter call in the attach path", () => {
    const dir = mkdtempSync(join(TMP_BASE, "replay-convergence-"));
    mkdirSync(
      join(dir, "foliplus", "js", "control", "LayerControl", "ui", "listPanel"),
      { recursive: true },
    );
    mkdirSync(join(dir, "foliplus", "js", "control", "LayerControl", "ui"), {
      recursive: true,
    });
    mkdirSync(join(dir, "foliplus", "js", "control", "LayerControl"), {
      recursive: true,
    });
    // controller.ts with a legit entry (no violations)
    writeFileSync(
      join(dir, "foliplus", "js", "control", "LayerControl", "controller.ts"),
      "class C { replayStoredState(id) { this.ui.applyUserState(id); this.replayFilter(id); } }\n",
    );
    // lifecycle.ts with a VIOLATION: direct replayFilter in the attach path
    writeFileSync(
      join(dir, "foliplus", "js", "control", "LayerControl", "ui", "lifecycle.ts"),
      "const moved = ui.c.replayStoredStateAll();\nthis.replayFilter(id);\n",
    );
    // list.ts clean
    writeFileSync(
      join(
        dir,
        "foliplus",
        "js",
        "control",
        "LayerControl",
        "ui",
        "listPanel",
        "list.ts",
      ),
      "const moved = ui.c.replayStoredStateAll();\n",
    );
    // index.ts clean (entry + helper)
    writeFileSync(
      join(dir, "foliplus", "js", "control", "LayerControl", "ui", "index.ts"),
      "applyUserState(id) { applyBorderToLayer(this, id); }\n",
    );
    const hits = findConvergenceViolations(dir);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({
      file: "foliplus/js/control/LayerControl/ui/lifecycle.ts",
    });
    rmSync(dir, { recursive: true, force: true });
  });
});
