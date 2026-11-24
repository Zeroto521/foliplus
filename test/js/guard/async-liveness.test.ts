// test/js/script/check/async-liveness — static guard for async continuations
// that outlive their mounting.
//
// Two defect classes, one rule each:
//
//  1. Control-level requests. navigator.geolocation.getCurrentPosition() and
//     the Fullscreen API's requestFullscreen() / exitFullscreen() resolve after
//     the click that asked for them. A control removed meanwhile must not write
//     back — no pseudo-fullscreen fallback, no pin, no hint on a control that is
//     gone. BaseControl already owns the answer (one AbortSignal per mounting,
//     aborted in onRemove before the cleanups run), so every such initiator in
//     foliplus/js/control must have a liveness token in the continuation it
//     opens: .signal / aborted / .removed, or an explicit
//     "// liveness-exempt: <reason>" for a continuation that only releases state.
//
//  2. Marker-level continuation. createLocationMarker's reverse-geocode
//     continuation writes onAddress and the popup after the pin may be gone
//     (control destroy -> removeMarker(), or a replacement pin). It is gated by
//     isLiveMarker(map, marker) before either write. That helper is shared with
//     MeasureControl's reverse-geocode path — do not re-derive map.hasLayer at a
//     call site.
//
// Teeth live beside the rules: livenessGaps() and markerContinuationGated() are
// pure over source text, and the cases below feed them an unguarded request, an
// exempted one and an unguarded continuation.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const JS_ROOT = resolve(REPO_ROOT, "foliplus/js");
const CONTROL_ROOT = resolve(JS_ROOT, "control");
const MARKER_MODULE = resolve(JS_ROOT, "core/geo/locationMarker.ts");

/** Requests whose continuation can outlive the control that asked for it. */
const INITIATOR_RE =
  /getCurrentPosition\s*\(|requestFullscreen\s*\(|exitFullscreen\s*\(/;

/** Sanctioned liveness references, plus the per-site exemption marker. */
const LIVE_RE = /\baborted\b|\.signal\b|\.removed\b|liveness-exempt:/;

/** How far past an initiator its continuation may sit. */
const CONTINUATION_WINDOW = 40;

/** Read every .ts under *dir*. */
const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (entry.endsWith(".ts")) out.push(path);
  }
  return out;
};

/** 1-based lines whose async request opens a continuation with neither a
 *  liveness token nor an exemption. */
const livenessGaps = (src: string): number[] => {
  const lines = src.split("\n");
  const gaps: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!INITIATOR_RE.test(lines[i])) continue;
    const window = lines.slice(i, i + CONTINUATION_WINDOW).join("\n");
    if (!LIVE_RE.test(window)) gaps.push(i + 1);
  }
  return gaps;
};

/** True when the marker module gates its address continuation on the marker's
 *  own liveness before the first write (onAddress). */
const markerContinuationGated = (src: string): boolean => {
  const gate = src.indexOf("if (!isLiveMarker(map, marker)) return;");
  const write = src.indexOf("if (onAddress) onAddress(resolved);");
  return gate >= 0 && write > gate;
};

describe("async continuations consult their liveness", () => {
  it("every control-level async request is followed by a liveness token", () => {
    const gaps = walk(CONTROL_ROOT).flatMap(file => {
      const rel = relative(REPO_ROOT, file).split("\\").join("/");
      return livenessGaps(readFileSync(file, "utf-8")).map(line => `${rel}:${line}`);
    });
    expect(gaps, gaps.join("\n")).toEqual([]);
  });

  it("the marker continuation is gated by isLiveMarker before onAddress", () => {
    expect(
      markerContinuationGated(readFileSync(MARKER_MODULE, "utf-8")),
      "createLocationMarker must gate its reverse-geocode writes with isLiveMarker(map, marker)",
    ).toBe(true);
  });

  it("the rule is not vacuous: controls still initiate async requests", () => {
    const hits = walk(CONTROL_ROOT).filter(file =>
      INITIATOR_RE.test(readFileSync(file, "utf-8")),
    );
    expect(hits.length).toBeGreaterThan(0);
  });

  it("teeth: an unguarded request is reported, a guarded one is not", () => {
    expect(livenessGaps("navigator.geolocation.getCurrentPosition(ok, fail);")).toEqual(
      [1],
    );
    expect(
      livenessGaps(
        "const signal = ctrl.signal;\nnavigator.geolocation.getCurrentPosition(\n  pos => { if (signal?.aborted) return; ok(pos); },\n  () => { if (signal?.aborted) return; fail(); },\n);",
      ),
    ).toEqual([]);
  });

  it("teeth: the exemption marker silences exactly the request it covers", () => {
    expect(
      livenessGaps(
        "document.exitFullscreen().then(() => {\n  // liveness-exempt: release only\n  clear();\n});",
      ),
    ).toEqual([]);
    expect(
      livenessGaps("document.exitFullscreen().then(() => {\n  clear();\n});"),
    ).toEqual([1]);
  });

  it("teeth: the marker gate must precede the first write", () => {
    expect(markerContinuationGated("if (onAddress) onAddress(resolved);")).toBe(false);
    expect(
      markerContinuationGated(
        "if (!isLiveMarker(map, marker)) return;\nif (onAddress) onAddress(resolved);",
      ),
    ).toBe(true);
  });
});
