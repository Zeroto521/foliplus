import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve, sep } from "path";
import { describe, expect, it } from "vitest";

// EventOrigin drift guard (task-193 PR-B).
//
// Every semantic layer event must travel through the single source
// `emitLayerEvent` (core/event) so its payload carries an `origin` —
// the subscriber-facing statement of who moved the layer. A bare
// `publish(EVENTS.LAYER_*)` or `.emit(EVENTS.LAYER_*)` elsewhere is a
// bypass: it cannot know the origin, so it would publish an origin-less
// (or guessed-origin) event. The only escapes are the two raw broadcasts
// that carry no layer identity (CONTROL_ATTACHED, OVERLAY_CLEAR) and the
// three notification-only signals the design left origin-less by contract
// (role count / no-basemap / list rebuild).
const REPO_ROOT = resolve(".");
const JS_DIR = resolve(REPO_ROOT, "foliplus/js");
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", ".git"]);

// Raw `publish(EVENTS.LAYER_*)` outside core/event: forbidden outright.
// The two raw broadcasts below are the only non-LAYER publishes a source
// may make outside core/event and are exempt only because they carry no
// layer identity — they are NOT layer events.
const RAW_PUBLISH_WHITELIST: Record<string, string> = {
  "BaseControl.ts": "CONTROL_ATTACHED",
  "control/LayerControl/ui/teardown.ts": "OVERLAY_CLEAR",
};

// `.emit(EVENTS.LAYER_*)` / `.emitSuperseding*(EVENTS.LAYER_*)` outside
// core/event: must carry `origin` UNLESS the signal is one of the three
// origin-less notifications the design excluded (a role-count / basemap /
// rebuild signal is a derived view hint, not a layer mutation).
const RAW_EMIT_ORIGINLESS = new Set([
  "LAYER_ROLE_COUNT_CHANGED",
  "LAYER_NO_BASEMAP_CHANGED",
  "LAYER_LIST_REBUILD",
]);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Strip comment-only lines so a prose mention of a forbidden call is not
 *  a violation. A line is "code" when it has non-comment, non-blank text. */
function isCode(line: string): boolean {
  const t = line.trim();
  if (t === "" || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
  return true;
}

describe("event origin static guard", () => {
  it("forbids a bare publish(EVENTS.LAYER_*) outside core/event", () => {
    const violations: string[] = [];
    for (const file of walk(JS_DIR, [])) {
      const rel = relative(JS_DIR, file);
      if (rel.startsWith("core" + sep + "event")) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!isCode(lines[i])) continue;
        const m = lines[i].match(/publish\s*\([^)]*EVENTS\.(LAYER_[A-Z_]+)/);
        if (m) violations.push(rel + ":" + (i + 1) + " " + m[0].trim());
      }
    }
    expect(violations).toEqual([]);
  });

  it("every emitLayerEvent call carries origin", () => {
    const violations: string[] = [];
    for (const file of walk(JS_DIR, [])) {
      const rel = relative(JS_DIR, file);
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!isCode(lines[i])) continue;
        if (!lines[i].includes("emitLayerEvent(")) continue;
        // Search forward (same line + next 8) for the payload's origin key.
        const window = lines.slice(i, i + 9).join("\n");
        if (!/origin\s*:/.test(window)) violations.push(rel + ":" + (i + 1) + " missing origin");
      }
    }
    expect(violations).toEqual([]);
  });

  it("a bare .emit(EVENTS.LAYER_*) outside core/event carries origin unless origin-less", () => {
    const violations: string[] = [];
    for (const file of walk(JS_DIR, [])) {
      const rel = relative(JS_DIR, file);
      if (rel.startsWith("core" + sep + "event")) continue;
      const lines = readFileSync(file, "utf8").split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!isCode(lines[i])) continue;
        const m = lines[i].match(/\.emit\w*\s*\(\s*EVENTS\.(LAYER_[A-Z_]+)/);
        if (!m) continue;
        const ev = m[1];
        if (RAW_EMIT_ORIGINLESS.has(ev)) continue;
        const window = lines.slice(i, i + 9).join("\n");
        if (!/origin\s*:/.test(window)) violations.push(rel + ":" + (i + 1) + " " + ev + " missing origin");
      }
    }
    expect(violations).toEqual([]);
  });
});
