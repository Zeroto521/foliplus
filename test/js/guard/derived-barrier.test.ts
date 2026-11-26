// test/js/script/check/derived-barrier — guard that the three derived-state
// projections (syncToggleAll / refreshAllCounts / refreshTreeConnectors) are
// only invoked through the invalidateDerived barrier, not directly from a
// structural-change path.
//
// The barrier (controller.ts invalidateDerived) is the single funnel that
// repaints the role headers, counts and tree connectors after any structural
// change. A new path that calls ui.syncToggleAll / ui.refreshAllCounts /
// ui.refreshTreeConnectors directly would silently bypass it — the counts
// would still look right in the happy case and the tests would stay green,
// so the drift is invisible until a real inconsistency (a stale count, a
// missing connector) shows up in a build. This guard pins every production
// call site of the three projections to the barrier (or to an explicit
// whitelist with the reason each site is legitimate).
import { initFixture, polygonLayer } from "../control/LayerControl/ui/fixture.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerController } from "#control/LayerControl/controller.js";
import type { LayerUI } from "#control/LayerControl/ui/index.js";

const REPO_ROOT = process.cwd();

// The three derived-state projections and the source files that may invoke
// them. Every non-barrier call site is listed with the reason it is legal
// (and the exact call text, self-verified so a line shift fails loudly
// instead of silently no longer matching):
//   - a full rebuild / row-move / batch-toggle path that re-derives the SAME
//     derived state the barrier also covers, OR
//   - the LayerUI method body that delegates to the module function (the
//     barrier's own entry point), OR
//   - the event subscriber that consumes the notification the barrier itself
//     publishes (the downstream half of the same round trip).
const ALLOWED_CALL_SITES: ReadonlyArray<{
  file: string;
  line: number;
  call: string;
  reason: string;
}> = [
  {
    file: "foliplus/js/control/LayerControl/ui/index.ts",
    line: 283,
    call: "return refreshAllCounts(this);",
    reason:
      "the LayerUI method body delegates to the module function (the barrier's entry point)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/index.ts",
    line: 288,
    call: "return refreshTreeConnectors(this);",
    reason:
      "the LayerUI method body delegates to the module function (the barrier's entry point)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/index.ts",
    line: 398,
    call: "return syncToggleAll(this, role);",
    reason:
      "the LayerUI method body delegates to the module function (the barrier's entry point)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/lifecycle.ts",
    line: 122,
    call: "refreshAllCounts(ui);",
    reason:
      "right after the synchronous attach sequence (replayStoredStateAll): the initial counts pass, not a structural change",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/lifecycle.ts",
    line: 443,
    call: "syncToggleAll(ui, payload.role);",
    reason:
      "LAYER_ROLE_COUNT_CHANGED subscriber: the notification the barrier itself publishes — the downstream consumer of the same round trip",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/list.ts",
    line: 88,
    call: "syncToggleAll(ui, ROLE.OVERLAY);",
    reason:
      "initTypesAndVisibility initial render: the role headers are synced once per rebuild from the freshly initialized rows",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/list.ts",
    line: 89,
    call: "syncToggleAll(ui, ROLE.BASE);",
    reason:
      "initTypesAndVisibility initial render: the role headers are synced once per rebuild from the freshly initialized rows",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/list.ts",
    line: 116,
    call: "ui.refreshAllCounts();",
    reason:
      "rebuildList full rebuild path: the counts are refreshed once after the rows are painted (the data-ready round)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/list.ts",
    line: 435,
    call: "refreshTreeConnectors(ui);",
    reason:
      "syncRowOrder: the rows moved, so the ├/└ connectors may no longer match the block they sit in (the reorder path)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/visibility.ts",
    line: 110,
    call: "syncToggleAll(ui, role);",
    reason:
      "visibility toggle path: one aggregate pass reconciles the role header after a batch toggle (the toggled rows' intent was just rewritten)",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/visibility.ts",
    line: 274,
    call: "syncToggleAll(ui, layerInfo.role);",
    reason:
      "visibility toggle path: one aggregate pass reconciles the role header after a single-row toggle",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/listPanel/visibility.ts",
    line: 378,
    call: "syncToggleAll(ui, role);",
    reason:
      "visibility toggle path: one aggregate pass reconciles the role header after a bulk tail toggle",
  },
];

// The barrier in controller.ts: every projection call inside invalidateDerived
// is allowed. The body range is computed at run time so the guard survives a
// comment-only edit above the method.
const BARRIER_FILE = "foliplus/js/control/LayerControl/controller.ts";
const BARRIER_METHOD = "invalidateDerived";

const EXEMPT_DIRS = new Set(["node_modules", ".git", "dist", "coverage", ".agents"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXEMPT_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.ts$/.test(entry.name)) yield full;
  }
}

/** The 1-based line range of the barrier method body, or null when the method
 *  is not found. The method signature is `invalidateDerived(...): void {` and
 *  its body runs until the matching closing brace. */
function barrierBodyRange(src: string): { start: number; end: number } | null {
  const lines = src.split(/\r?\n/);
  // The method signature line carries the opening brace; a comment mention
  // ("...calls invalidateDerived()") has no brace and must not start the scan.
  const startIdx = lines.findIndex(l =>
    new RegExp(`\\b${BARRIER_METHOD}\\s*\\(.*\\{\s*$`).test(l),
  );
  if (startIdx < 0) return null;
  let depth = 0;
  let opened = false;
  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        opened = true;
      } else if (ch === "}") {
        depth--;
        if (opened && depth === 0) return { start: startIdx + 1, end: i + 1 };
      }
    }
  }
  return null;
}

/** Collect production call sites of the three projections as
 *  { file, line, name } — a "call site" is a line where one of the three names
 *  is invoked (as ui.<name>(...) or <name>(ui, ...)), excluding the declaration
 *  forms (const arrow / function / interface method / method body opener). */
function collectCallSites(): { file: string; line: number; name: string }[] {
  const out: { file: string; line: number; name: string }[] = [];
  const srcRoot = join(REPO_ROOT, "foliplus", "js");
  const callRe =
    /\b(?:ui\.)?(syncToggleAll|refreshAllCounts|refreshTreeConnectors)\s*\(([^)]*)\)/;
  for (const file of walk(srcRoot)) {
    const rel = file.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
    const lines = readFileSync(file, "utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const bare = lines[i].split("//")[0]; // strip a trailing line comment
      const m = bare.match(callRe);
      if (!m) continue;
      const args = m[2];
      // Declaration forms are not call sites:
      if (/\bconst\s+/.test(bare) || /\bfunction\s+/.test(bare)) continue; // arrow / function definition
      if (/:\s*[A-Za-z_]/.test(args)) continue; // type-annotated params → method / interface declaration
      if (/\)\s*:\s*[A-Za-z_]/.test(bare)) continue; // return-type annotation → method / interface
      if (/\{\s*$/.test(bare.trim()) && !/;\s*$/.test(bare.trim())) continue; // zero-arg method body opener
      out.push({ file: rel, line: i + 1, name: m[1] });
    }
  }
  return out;
}

describe("derived-state barrier", () => {
  it("keeps every production call of the three projections inside invalidateDerived or an explicit whitelist", () => {
    const sites = collectCallSites();
    const violations: string[] = [];
    for (const site of sites) {
      if (site.file === BARRIER_FILE) {
        const range = barrierBodyRange(
          readFileSync(join(REPO_ROOT, site.file), "utf-8"),
        );
        if (range && site.line >= range.start && site.line <= range.end) continue; // inside the barrier
      }
      const entry = ALLOWED_CALL_SITES.find(
        a => a.file === site.file && a.line === site.line,
      );
      if (entry) continue;
      violations.push(
        `${site.file}:${site.line} calls ${site.name} — outside the invalidateDerived barrier and not on the whitelist`,
      );
    }
    expect(violations).toEqual([]);
  });

  it("self-verifies each whitelisted line still holds the expected call", () => {
    const failures: string[] = [];
    for (const entry of ALLOWED_CALL_SITES) {
      const lines = readFileSync(join(REPO_ROOT, entry.file), "utf-8").split(/\r?\n/);
      const line = lines[entry.line - 1] ?? "";
      if (!line.includes(entry.call)) {
        failures.push(
          `${entry.file}:${entry.line} expected \"${entry.call}\" but got \"${line.trim()}\" (line shifted? update the whitelist)`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});

describe("ui derived-state mechanism — the barrier re-derives every dimension", () => {
  let manager: LayerController;
  let ui: LayerUI;

  beforeEach(() => {
    ({ manager, ui } = initFixture());
  });

  afterEach(() => {
    manager?.debouncedEnforce?.cancel?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("registerLayer schedules a barrier that re-derives tree connectors", () => {
    const spy = vi.spyOn(ui, "refreshTreeConnectors");
    manager.registerLayer({
      id: "overlay2",
      name: "Late",
      role: "overlay",
      layer: polygonLayer(),
    });
    expect(spy).toHaveBeenCalled();
  });

  it("deleteLayer schedules a barrier that re-derives tree connectors", () => {
    const spy = vi.spyOn(ui, "refreshTreeConnectors");
    manager.deleteLayer("overlay1");
    expect(spy).toHaveBeenCalled();
  });
});
