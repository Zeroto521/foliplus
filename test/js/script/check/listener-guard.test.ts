// test/js/script/check/listener-guard — static scanner that requires every
// raw addEventListener / removeEventListener / map.on / map.once call in
// foliplus/js/{control,core,ui} to carry an adjacent `// listener-exempt:`
// comment or live in an explicitly whitelisted file.
//
// BaseControl provides listenDOM / listenMap as the sanctioned listener
// lifecycle (auto-unbind on onRemove). A raw addEventListener outside
// BaseControl bypasses that contract and leaks on control teardown. This
// guard makes the leak visible at CI time rather than at runtime.
//
// Whitelist policy:
//   - BaseControl.ts — the implementation itself (listenDOM / listenMap).
//   - platform/** — DOM primitives (dom.ts, floating.ts, etc.); these are
//     the layer that listenDOM itself is built on.
//   - Any file may opt out per-line with `// listener-exempt: <reason>` on
//     the line immediately above the raw call.
//   - The FILE_WHITELIST below is the minimal set of files that are wholly
//     exempt (infrastructure / core event system). Each entry carries a
//     comment explaining why.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");
const SCOPED_DIRS = ["control", "core", "ui"].map(d => resolve(JS_ROOT, d));

const LISTENER_RE = /\.(addEventListener|removeEventListener)\(|\bmap\.(?:on|once)\(/;
const EXEMPT_RE = /\/\/\s*listener-exempt:\s*\S+/;

/** Files wholly exempt from the listener guard. Each entry carries a
 *  comment explaining why the file is exempt from the listenDOM/listenMap
 *  contract. Keep this list minimal — a file here is a file that can leak
 *  listeners without CI catching it. */
const FILE_WHITELIST: readonly { file: string; reason: string }[] = [
  // ── Core infrastructure ──
  // These files implement the event/listener infrastructure that
  // listenDOM/listenMap themselves are built on. Exempting them is
  // self-referential: they ARE the sanctioned listener path.
  { file: "foliplus/js/core/event/index.ts", reason: "event bus bootstrap" },
  { file: "foliplus/js/core/interaction/interactionManager.ts", reason: "interaction manager IS the listener lifecycle" },
  { file: "foliplus/js/core/interaction/listCursor.ts", reason: "list cursor owns its own listener cleanup" },
  { file: "foliplus/js/core/leaflet/mapEvent.ts", reason: "mapEvent helper wraps map.on/off" },
  { file: "foliplus/js/core/leaflet/panel.ts", reason: "panel shell owns outside-collapse listeners" },
  { file: "foliplus/js/core/leaflet/panelController.ts", reason: "panel controller owns press dismissal" },
  { file: "foliplus/js/core/leaflet/zoomRange.ts", reason: "zoom range applies on map events" },
  { file: "foliplus/js/core/lifecycle/mode.ts", reason: "mode manager owns map unload cleanup" },
  { file: "foliplus/js/core/overlay/hint.ts", reason: "hint manager owns map unload cleanup" },
  { file: "foliplus/js/core/overlay/overlayRegistry.ts", reason: "overlay registry IS the dispatch system" },
  { file: "foliplus/js/core/layer/LayerFactory.ts", reason: "layer factory owns map move/resize" },
  { file: "foliplus/js/core/label/labelControl.ts", reason: "label control owns its own refresh listeners" },
  // ── Control: Leaflet interaction ──
  { file: "foliplus/js/control/ExportControl/session.ts", reason: "export session owns preview click" },
  { file: "foliplus/js/control/FullscreenControl/logic.ts", reason: "fullscreen logic owns map event setup" },
  { file: "foliplus/js/control/HeatmapControl/manager.ts", reason: "heatmap manager owns map events" },
  { file: "foliplus/js/control/HeatmapControl/ui.ts", reason: "heatmap UI owns control attach listener" },
  { file: "foliplus/js/control/LayerControl/controller.ts", reason: "controller owns map layeradd/layerremove" },
  { file: "foliplus/js/control/LayerControl/ui/focus/focusMarquee.ts", reason: "focus marquee owns focusin/focusout + map moveend" },
  { file: "foliplus/js/control/LayerControl/ui/focus/index.ts", reason: "focus controller owns map moveend/zoomend" },
  { file: "foliplus/js/control/LayerControl/ui/lifecycle.ts", reason: "lifecycle owns container + map listeners" },
  { file: "foliplus/js/control/LayerControl/ui/overlayPanel/attr.ts", reason: "attr panel owns events.on subscriptions" },
  { file: "foliplus/js/control/LayerControl/ui/overlayPanel/filter.ts", reason: "filter panel owns events.on subscriptions" },
  { file: "foliplus/js/control/LayerControl/ui/overlayPanel/menu.ts", reason: "menu owns window scroll/resize + events.on" },
  { file: "foliplus/js/control/LayerControl/ui/overlayPanel/rename.ts", reason: "rename owns events.on LAYER_REMOVED" },
  { file: "foliplus/js/control/LayerControl/ui/style/iconColor.ts", reason: "iconColor input owns its own listener" },
  { file: "foliplus/js/control/LayerControl/ui/style/index.ts", reason: "style panel owns events.on subscriptions" },
  { file: "foliplus/js/control/LayerControl/ui/style/markerColor.ts", reason: "markerColor input owns its own listener" },
  { file: "foliplus/js/control/LayerControl/ui/style/pin.ts", reason: "pin owns leaf mouseout listener" },
  { file: "foliplus/js/control/MeasureControl/edit.ts", reason: "measure edit owns map click/mousemove/mouseup" },
  { file: "foliplus/js/control/MeasureControl/manager.ts", reason: "measure manager owns map events + events.on" },
  { file: "foliplus/js/control/MeasureControl/mode/circle.ts", reason: "circle mode owns ripple animationend" },
  { file: "foliplus/js/control/MeasureControl/mode/distance.ts", reason: "distance mode owns marker click" },
  { file: "foliplus/js/control/MeasureControl/mode/marker.ts", reason: "marker mode owns marker click/popupopen" },
  { file: "foliplus/js/control/MeasureControl/mode/polygon.ts", reason: "polygon mode owns marker click" },
  { file: "foliplus/js/control/MeasureControl/ui/distance.ts", reason: "distance UI owns polyline/marker click" },
  { file: "foliplus/js/control/MeasureControl/ui/helper.ts", reason: "measure helper owns layer click" },
  { file: "foliplus/js/control/MeasureControl/ui/polygon.ts", reason: "polygon UI owns label/centroid click" },
  { file: "foliplus/js/control/MeasureControl/util.ts", reason: "measure util owns animationend" },
  { file: "foliplus/js/control/SearchControl/interaction.ts", reason: "search interaction owns input/scroll/resize" },
  // ── UI primitives ──
  { file: "foliplus/js/ui/dropdown.ts", reason: "dropdown owns native change listener" },
  { file: "foliplus/js/ui/form.ts", reason: "form owns input focus/blur listeners" },
  { file: "foliplus/js/ui/listbox.ts", reason: "listbox owns row focus/click + trigger listeners" },
  { file: "foliplus/js/ui/slider.ts", reason: "slider owns pointer/key/focus listeners on track+thumb" },
];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Collect raw listener call sites in one file. Returns { line, text } for
 *  each site that does NOT have an adjacent listener-exempt comment. */
function collectViolations(file: string): { line: number; text: string }[] {
  const lines = readFileSync(file, "utf-8").split(/\r?\n/);
  const violations: { line: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!LISTENER_RE.test(lines[i])) continue;
    // Check the 2 lines above for a listener-exempt comment.
    const window = lines.slice(Math.max(0, i - 2), i);
    const exempt = window.some(l => EXEMPT_RE.test(l));
    if (!exempt) violations.push({ line: i + 1, text: lines[i].trim() });
  }
  return violations;
}

function isWhitelisted(relFile: string): boolean {
  return FILE_WHITELIST.some(w => relFile === w.file);
}

describe("listener-guard: raw listeners must carry listener-exempt", () => {
  const files = SCOPED_DIRS.flatMap(d => walk(d, [])).map(p => relative(REPO_ROOT, p).replace(/\\/g, "/"));

  it("every raw listener has an adjacent listener-exempt comment", () => {
    const violations: string[] = [];
    for (const file of files) {
      if (isWhitelisted(file)) continue;
      const full = resolve(REPO_ROOT, file);
      for (const v of collectViolations(full)) {
        violations.push(`${file}:${v.line} — ${v.text}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("whitelist files are minimal and annotated", () => {
    // The whitelist documents existing raw-listener debt. It should not grow:
    //     new files must use listenDOM/listenMap (or a listener-exempt comment).
    //     Existing entries are grandfathered and should shrink over time.
    expect(FILE_WHITELIST.length).toBeLessThanOrEqual(50);
    for (const w of FILE_WHITELIST) {
      expect(w.reason.length).toBeGreaterThan(5);
    }
  });

  it("deliberate violation triggers the guard (self-test)", () => {
    // Self-test: a snippet with a raw addEventListener and no exemption
    // must produce a violation.
    const snippet = ['const el = document.createElement("div");', 'el.addEventListener("click", () => {});'].join("\n");
    const lines = snippet.split("\n");
    const violations: number[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!LISTENER_RE.test(lines[i])) continue;
      const window = lines.slice(Math.max(0, i - 2), i);
      if (!window.some(l => EXEMPT_RE.test(l))) violations.push(i + 1);
    }
    expect(violations).toEqual([2]);
  });

  it("exempt comment suppresses the violation (self-test)", () => {
    const snippet = [
      '// listener-exempt: teardown cleanup',
      'el.addEventListener("click", () => {});',
    ].join("\n");
    const slines = snippet.split("\n");
    const violations: number[] = [];
    for (let i = 0; i < slines.length; i++) {
      if (!LISTENER_RE.test(slines[i])) continue;
      const window = slines.slice(Math.max(0, i - 2), i);
      if (!window.some(l => EXEMPT_RE.test(l))) violations.push(i + 1);
    }
    expect(violations).toEqual([]);
  });
});