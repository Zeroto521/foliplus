import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  DIMENSION_REPLAY_CALLS,
  SANCTIONED_BODIES,
  SKIP_DIR,
  __entryUrl,
  findConvergenceViolations,
  isDefinition,
  main,
  runCli,
  startsSanctionedBody,
  stripSanctionedBodies,
  walk,
} from "#script/check/replay-convergence.mjs";

// LayerControl replay-path convergence guard (replay convergence): the two registration
// paths (construction-seeded A path and layeradd/registerLayer B path) must
// call ONLY the single replay entries — replayStoredState / replayStoredStateAll
// — never the per-dimension replay functions directly. A new dimension added to
// one path but not the other recreates the #1181 class of bug (a seed layer
// dropping its stored filter). The dimension functions are sanctioned only
// inside the entries and the applyUserState style-dims helper.

const REPO_ROOT = process.cwd();
// Prefer the OS temp dir (TEMP on Windows / TMPDIR on CI Linux); the
// .foliplus/tmp fallback must be created first — mkdtempSync does NOT create
// missing parents, so a bare fallback throws ENOENT on a fresh CI checkout.
const TMP_BASE = (() => {
  for (const key of ["TEMP", "TMPDIR", "TMP"]) {
    const p = process.env[key];
    if (p && existsSync(p)) return p;
  }
  const fallback = resolve(process.cwd(), ".foliplus", "tmp");
  mkdirSync(fallback, { recursive: true });
  return fallback;
})();

/** Build a synthetic LayerControl tree under a fresh temp dir. The four
 *  guard-target files are written so the test controls exactly what the
 *  scanner sees; the dir is removed in the caller's finally. */
const makeTree = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(TMP_BASE, "replay-convergence-"));
  for (const [rel, text] of Object.entries(files)) {
    const p = join(dir, rel);
    mkdirSync(resolve(p, ".."), { recursive: true });
    writeFileSync(p, text);
  }
  return dir;
};

describe("convergence vocabularies", () => {
  it("lists every per-dimension replay function the guard watches", () => {
    expect(DIMENSION_REPLAY_CALLS).toContain("replayFilter");
    expect(DIMENSION_REPLAY_CALLS).toContain("applyUserState");
    expect(DIMENSION_REPLAY_CALLS).toContain("replaySavedOrder");
  });

  it("sanctions exactly the replay entries and the style-dims helper", () => {
    expect(SANCTIONED_BODIES).toEqual([
      "replayStoredState",
      "replayStoredStateAll",
      "applyUserState",
    ]);
  });

  it("skips node_modules / dist / .venv / .git / coverage / .agents", () => {
    for (const d of SKIP_DIR) expect(d).toBeTruthy();
    expect(SKIP_DIR.has("node_modules")).toBe(true);
    expect(SKIP_DIR.has("dist")).toBe(true);
  });
});

describe("walk", () => {
  it("returns [] for a missing dir", () => {
    const dir = mkdtempSync(join(TMP_BASE, "replay-convergence-"));
    try {
      expect(walk(join(dir, "nope"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("collects .ts files recursively and skips SKIP_DIR entries", () => {
    const dir = makeTree({
      "a.ts": "",
      "sub/b.ts": "",
      "c.js": "", // non-.ts: exercises the else-if false side (line 73)
      "node_modules/dep/c.ts": "",
      "dist/d.ts": "",
    });
    try {
      const files = walk(dir);
      const rels = files.map(f => resolve(f));
      expect(files.length).toBe(2);
      expect(rels).toContain(resolve(dir, "a.ts"));
      expect(rels).toContain(resolve(dir, "sub", "b.ts"));
      expect(rels).not.toContain(resolve(dir, "c.js"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("startsSanctionedBody", () => {
  it("recognizes a class-method definition with a same-line brace", () => {
    expect(
      startsSanctionedBody("  replayStoredState(id: string): ProjectionBatch {"),
    ).toBe(true);
  });

  it("recognizes a function declaration and a bare const name", () => {
    expect(startsSanctionedBody("function applyUserState(id) {")).toBe(true);
    expect(startsSanctionedBody("const applyUserState = id => {")).toBe(false);
  });

  it("does not treat a receiver call as a definition", () => {
    expect(startsSanctionedBody("const moved = ui.c.replayStoredStateAll();")).toBe(
      false,
    );
    expect(startsSanctionedBody("this.replayFilter(id);")).toBe(false);
  });

  it("covers the fnRe path: a const/function declaration line that headRe misses", () => {
    // fnRe path (line 94): headRe needs the name followed by "(" AND a brace on
    // the same line; "function applyUserState(id)" has no brace, so headRe's
    // method branch (m && /\{/) fails and fnRe is the only matcher that fires.
    expect(startsSanctionedBody("function applyUserState(id)")).toBe(true);
  });

  it("rejects a receiver call with a same-line brace (headRe excludes the dot)", () => {
    // A receiver call (this./ui./c.) never matches headRe because its prefix
    // class [^A-Za-z0-9_.] rejects a preceding dot — so it falls through and
    // must not be treated as a sanctioned body.
    expect(startsSanctionedBody("const x = this.replayStoredState(id) {")).toBe(false);
    expect(startsSanctionedBody("ui.replayStoredState(id) {")).toBe(false);
  });
});

describe("isDefinition", () => {
  it("recognizes a definition and rejects a call site", () => {
    expect(isDefinition("  replayFilter(id: string): void {", "replayFilter")).toBe(
      true,
    );
    expect(isDefinition("    this.replayFilter(id);", "replayFilter")).toBe(false);
    expect(isDefinition("const x = replayFilter(id);", "replayFilter")).toBe(false);
  });
});

describe("stripSanctionedBodies", () => {
  it("removes the sanctioned entry bodies and keeps outside code", () => {
    const src = [
      "class C {",
      "  replayStoredState(id) { this.ui.applyUserState(id); this.replayFilter(id); }",
      "  outside() { this.replayFilter(id); }",
      "}",
    ].join("\n");
    const out = stripSanctionedBodies(src);
    expect(out).toContain("outside() { this.replayFilter(id); }");
    expect(out).not.toContain("replayStoredState(id) {");
  });

  it("keeps a lone outside line when no sanctioned body starts", () => {
    expect(stripSanctionedBodies("const x = 1;")).toBe("const x = 1;");
  });
});

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

  it("skips a target file that does not exist (partial synthetic tree)", () => {
    const dir = makeTree({
      "foliplus/js/control/LayerControl/controller.ts": "class C {}\n",
    });
    try {
      const hits = findConvergenceViolations(dir);
      expect(hits).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("flags a bare module-level dimension call (no receiver)", () => {
    const dir = makeTree({
      "foliplus/js/control/LayerControl/controller.ts":
        "class C { replayStoredState(id) { this.replayFilter(id); } }\n",
      "foliplus/js/control/LayerControl/ui/lifecycle.ts": "replayFilter(id);\n", // bare call, not a definition
      "foliplus/js/control/LayerControl/ui/listPanel/list.ts": "",
      "foliplus/js/control/LayerControl/ui/index.ts": "",
    });
    try {
      const hits = findConvergenceViolations(dir);
      expect(hits.length).toBe(1);
      expect(hits[0]).toMatchObject({
        file: "foliplus/js/control/LayerControl/ui/lifecycle.ts",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("main / runCli", () => {
  it("main returns 0 on a clean tree and prints nothing", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(REPO_ROOT)).toBe(0);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  it("main returns 1 and prints the violation on a dirty tree", () => {
    const dir = makeTree({
      "foliplus/js/control/LayerControl/controller.ts": "class C {}\n",
      "foliplus/js/control/LayerControl/ui/lifecycle.ts": "this.replayFilter(id);\n",
      "foliplus/js/control/LayerControl/ui/listPanel/list.ts": "",
      "foliplus/js/control/LayerControl/ui/index.ts": "",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(main(dir)).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("this.replayFilter(id);");
    } finally {
      log.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runCli sets exitCode only when the entry matches the module URL", () => {
    runCli([REPO_ROOT], __entryUrl);
    expect(process.exitCode).toBe(0);
    // A different entry must not touch exitCode.
    runCli([REPO_ROOT], "/some/other/entry.mjs");
    expect(process.exitCode).toBe(0);
  });

  it("runCli executes main when the entry matches and a dirty tree sets exit 1", () => {
    const dir = makeTree({
      "foliplus/js/control/LayerControl/controller.ts": "class C {}\n",
      "foliplus/js/control/LayerControl/ui/lifecycle.ts": "this.replayFilter(id);\n",
      "foliplus/js/control/LayerControl/ui/listPanel/list.ts": "",
      "foliplus/js/control/LayerControl/ui/index.ts": "",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runCli([dir], __entryUrl);
      expect(process.exitCode).toBe(1);
      const out = log.mock.calls.map(a => a.join(" ")).join("\n");
      expect(out).toContain("this.replayFilter(id);");
    } finally {
      log.mockRestore();
      process.exitCode = 0;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runCli falls back to cwd when argv is empty (line 197 || side)", () => {
    // Empty argv[0] → main(process.cwd()) — the clean-tree exit-0 path, but it
    // exercises the || process.cwd() fallback branch.
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runCli([], __entryUrl);
      expect(process.exitCode).toBe(0);
    } finally {
      log.mockRestore();
      process.exitCode = 0;
    }
  });
});
