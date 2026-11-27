#!/usr/bin/env node
// script/check/replay-convergence — stored layer state replays through one entry, so no dimension replays on one path only
/**
 * Guard: LayerControl stored-state replay path convergence (replay convergence).
 *
 * A layer's stored dimensions (visible / opacity / zoomRange / name / order /
 * style dims / filter) must replay through ONE entry — replayStoredState(id)
 * for a single layer and replayStoredStateAll() for the attach sweep. The two
 * registration paths (construction-seeded A path and layeradd/registerLayer B
 * path) must call only those entries, never the per-dimension replay functions
 * directly. Without this guard a new dimension added to one path but not the
 * other recreates the #1181 class of bug (a seed layer dropping its filter).
 *
 * Scope: foliplus/js/control/LayerControl (controller.ts, ui/lifecycle.ts,
 * ui/listPanel/list.ts, ui/index.ts) — the two registration paths and the
 * replay entry. The dimension functions themselves are declared elsewhere
 * (state.ts, style/*) and are not scanned for call sites; only the four files
 * that own the registration paths and the entry are.
 *
 * Sanctioned callers (bodies that MAY call the dimension functions):
 *   - replayStoredState / replayStoredStateAll (the single entries)
 *   - the applyUserState UI-shell method (ui/index.ts) — the style-dims
 *     replay helper those entries call.
 *
 * Usage: `node script/check/replay-convergence.mjs [root]`
 *   Prints each violation as `file:line: text` and exits 1 when any are found.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The per-dimension replay functions that must be called only from the replay
// entry (replayStoredState / replayStoredStateAll) or the applyUserState
// helper — never from the two registration paths directly.
const DIMENSION_REPLAY_CALLS = [
  "applyUserState",
  "replayFilter",
  "replaySavedOrder",
  "applyNameProjection",
  "applyBorderToLayer",
  "replayFillState",
  "applySizeToLayer",
  "applyIconToLayer",
  "applyIconColorToLayer",
  "applyMarkerColorToLayer",
  "replayDeclaredFill",
  "replayDeclaredBorder",
  "replayDeclaredMarkerColor",
];

// Sanctioned body names: inside these method/function bodies, dimension calls
// are allowed (they are the replay entries or the style-dims helper).
const SANCTIONED_BODIES = [
  "replayStoredState",
  "replayStoredStateAll",
  "applyUserState",
];

const SKIP_DIR = new Set([
  "node_modules",
  "dist",
  ".venv",
  ".git",
  "coverage",
  ".agents",
]);

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
};

/** Whether a line starts a sanctioned body: a class method, const or function
 *  whose name is in SANCTIONED_BODIES, followed by a signature and an opening
 *  brace on the same or next line. */
const startsSanctionedBody = line => {
  for (const name of SANCTIONED_BODIES) {
    // A sanctioned entry body starts at a method/const/function DEFINITION:
    // the name is not preceded by a receiver dot (this./ui./c. — that would be
    // a CALL, not a definition), and a body brace is on the same line.
    const headRe = new RegExp(`(^|[^A-Za-z0-9_.])${name}\\s*\\(`);
    // headRe's prefix class [^A-Za-z0-9_.] already excludes a preceding dot, so
    // a receiver call (this./ui./c.) can never match — no dotBefore check needed.
    if (headRe.test(line) && /\{/.test(line)) return true;
    const fnRe = new RegExp(`(?:const|function)\\s+${name}\\s*\\(`);
    if (fnRe.test(line)) return true;
  }
  return false;
};

/** Whether a line is a method/function DEFINITION of the given name (not a
 *  call site). A definition has the name directly followed by `(...) { ` with no
 *  receiver dot. */
const isDefinition = (line, name) => {
  const re = new RegExp(
    `(?:^|\\s)(?:private|public|protected|static|async|const|function|export)?\\s*${name}\\s*\\(`,
  );
  return re.test(line) && !/(?:this|ui|c)\./.test(line) && /\{/.test(line);
};

/** Strip the sanctioned bodies (replay entries + applyUserState helper) so
 *  only "outside" code is scanned. Handles nested braces. */
const stripSanctionedBodies = text => {
  const lines = text.split(/\r?\n/);
  const kept = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (startsSanctionedBody(line)) {
      let depth = 0;
      let started = false;
      let j = i;
      while (j < lines.length) {
        for (const ch of lines[j]) {
          if (ch === "{") {
            depth++;
            started = true;
          } else if (ch === "}") depth--;
        }
        j++;
        if (started && depth <= 0) break;
      }
      i = j;
      continue;
    }
    kept.push(line);
    i++;
  }
  return kept.join("\n");
};

/** Find direct dimension-replay calls outside the sanctioned bodies.
 * @returns [{file, line, text}] repo-relative file, 1-based line.
 */
const findConvergenceViolations = (root = process.cwd()) => {
  const targets = [
    path.join(root, "foliplus", "js", "control", "LayerControl", "controller.ts"),
    path.join(root, "foliplus", "js", "control", "LayerControl", "ui", "lifecycle.ts"),
    path.join(
      root,
      "foliplus",
      "js",
      "control",
      "LayerControl",
      "ui",
      "listPanel",
      "list.ts",
    ),
    path.join(root, "foliplus", "js", "control", "LayerControl", "ui", "index.ts"),
  ];
  const violations = [];
  for (const file of targets) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    const outside = stripSanctionedBodies(text);
    const lines = outside.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const fn of DIMENSION_REPLAY_CALLS) {
        // Call via this/ui/ui.c receiver, or a bare module call. Exclude
        // definitions (the name followed by a signature and an opening brace).
        const callRe = new RegExp(`(?:this|ui(?:\\.c)?|\\bc)\\.${fn}\\s*\\(`);
        const bareRe = new RegExp(`(^|[^.\\w])${fn}\\s*\\(`);
        const isCall =
          callRe.test(line) || (bareRe.test(line) && !isDefinition(line, fn));
        if (isCall) {
          violations.push({
            file: path.relative(root, file).replace(/\\/g, "/"),
            line: i + 1,
            text: line.trim(),
          });
          break;
        }
      }
    }
  }
  return violations;
};

const main = (root = process.cwd()) => {
  const hits = findConvergenceViolations(root);
  for (const h of hits) console.log(`${h.file}:${h.line}: ${h.text}`);
  return hits.length ? 1 : 0;
};

const runCli = (argv, entry, selfUrl = fileURLToPath(import.meta.url)) => {
  if (entry !== undefined && path.resolve(entry) === selfUrl) {
    process.exitCode = main(argv[0] || process.cwd());
  }
};
runCli(process.argv.slice(2), process.argv[1]);

export {
  DIMENSION_REPLAY_CALLS,
  SANCTIONED_BODIES,
  SKIP_DIR,
  walk,
  startsSanctionedBody,
  isDefinition,
  stripSanctionedBodies,
  findConvergenceViolations,
  main,
  runCli,
};
