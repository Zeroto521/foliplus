import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, resolve } from "path";
import { describe, expect, it } from "vitest";

// Bare-timer drift guard.
//
// Delayed work belongs to a timer owner: `createTimers()` from
// `platform/timer.ts` names the callback and ties its lifetime to the thing
// that scheduled it, so a teardown drops it instead of leaving a repaint or a
// lookup to fire against a destroyed control. A bare `setTimeout` /
// `setInterval` / `requestAnimationFrame` has no owner and outlives the
// component that scheduled it — the failure mode the migration removed
// (LayerControl #1385/#1367 follow-up, then the remaining controls).
//
// A site may still call the host scheduler directly only when it is one of:
//  - the timers primitive itself (it is the owner interface, not delayed work),
//  - a call-shape wrapper (debounce / throttle model the owner-less shape and
//    take their cancellation from the caller — `timer.ts` says so),
//  - a one-shot step where the raw scheduling IS the mechanism: a promise that
//    must resolve after a frame, a rate-limit sleep, an object-URL revoke, a
//    parked node in a state machine, or a gesture's frame that focusout cancels.
//
// Whitelist entries are (file, code fingerprint) pairs, never line numbers:
// prettier moves lines but the code that legitimately needs the raw call does
// not. Every entry must still hit a live line — an entry that outlives its code
// fails loudly instead of quietly widening the exemption.
const REPO_ROOT = resolve(".");
const JS_DIR = resolve(REPO_ROOT, "foliplus/js");
const SKIP_DIR = new Set(["node_modules", "dist", "coverage", ".git"]);
const CALL_RE = /\b(?:window\.)?(?:setTimeout|setInterval|requestAnimationFrame)\(/;
const MIN_REASON_LENGTH = 30;

interface AllowedSite {
  /** Path relative to the repo root, POSIX separators. */
  file: string;
  /** Fingerprint of the code line that must still schedule directly. */
  code: string;
  /** Why this site has no owner to protect it (or why the raw call IS the step). */
  reason: string;
}

const ALLOWED: AllowedSite[] = [
  {
    file: "foliplus/js/platform/timer.ts",
    code: "id: setTimeout(() => {",
    reason:
      "the timer owner's own timeout primitive — this module IS the owner every other module calls",
  },
  {
    file: "foliplus/js/platform/timer.ts",
    code: '({ kind: "interval", id: setInterval(fn, ms) })',
    reason:
      "the timer owner's own interval primitive — this module IS the owner every other module calls",
  },
  {
    file: "foliplus/js/platform/timer.ts",
    code: "id: requestAnimationFrame(time => {",
    reason:
      "the timer owner's own frame primitive — this module IS the owner every other module calls",
  },
  {
    file: "foliplus/js/platform/debounce.ts",
    code: "timer = setTimeout(() => {",
    reason:
      "call-shape wrapper: debounce models the owner-less deferral shape and its cancel() is the caller's handle",
  },
  {
    file: "foliplus/js/platform/throttle.ts",
    code: "rafId = requestAnimationFrame(() => {",
    reason:
      "call-shape wrapper: throttle models the owner-less frame shape and its cancel() is the caller's handle",
  },
  {
    file: "foliplus/js/platform/throttle.ts",
    code: "const rafId = requestAnimationFrame(fn);",
    reason:
      "call-shape wrapper: throttle models the owner-less frame shape and its cancel() is the caller's handle",
  },
  {
    file: "foliplus/js/platform/download.ts",
    code: "setTimeout(() => URL.revokeObjectURL(url), revokeDelayMs);",
    reason:
      "one-shot object-URL revoke after a download click: no component owns the URL, and the revoke must still happen",
  },
  {
    file: "foliplus/js/platform/fetch.ts",
    code: "const timeoutHandle = setTimeout(onTimeout, timeoutMs);",
    reason:
      "timeout companion of an in-flight fetch; the same function clears it in its finally, so the request is the owner",
  },
  {
    file: "foliplus/js/core/geocode/rateLimit.ts",
    code: "return new Promise(r => setTimeout(r, wait));",
    reason:
      "rate-limit sleep must resolve: a disposable sleep would leave the queue waiting forever (the classification keeps this one)",
  },
  {
    file: "foliplus/js/ui/slider.ts",
    code: "timer = window.setTimeout(detach, 150);",
    reason:
      "pendingHide is a parked reusable node, not scheduled work: the detach delay is part of the slider's state machine",
  },
  {
    file: "foliplus/js/ui/slider.ts",
    code: "requestAnimationFrame(() => {",
    reason:
      "post-paint measure of a parked node: the frame reads layout once and nothing survives it to cancel",
  },
  {
    file: "foliplus/js/ui/slider.ts",
    code: "this.bubbleFrame = requestAnimationFrame(() => {",
    reason:
      "coalesced bubble repaint frame, keyed by bubbleFrame and superseded on every pointer move",
  },
  {
    file: "foliplus/js/control/ExportControl/renderer/index.ts",
    code: "new Promise(resolve => requestAnimationFrame(() => resolve()));",
    reason:
      "awaits one frame before measuring export geometry: the promise must resolve even while the control is being removed",
  },
  {
    file: "foliplus/js/control/LayerControl/ui/focus/focusMarquee.ts",
    code: "rafId = requestAnimationFrame(() => {",
    reason:
      "the marquee frame is cancelled by the focusout/unbind gesture itself; the gesture is the owner",
  },
];

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Drop line comments before matching, so prose about setTimeout is not a call. */
function codeOnly(line: string): string {
  const trimmed = line.trim();
  if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
    return "";
  }
  const commentAt = trimmed.indexOf("//");
  return commentAt === -1 ? trimmed : trimmed.slice(0, commentAt).trim();
}

interface CodeSite {
  /** Path relative to the repo root, POSIX separators. */
  file: string;
  line: number;
  text: string;
}

function codeSites(): CodeSite[] {
  const sites: CodeSite[] = [];
  for (const abs of walk(JS_DIR, [])) {
    const file = relative(REPO_ROOT, abs).split("\\").join("/");
    const lines = readFileSync(abs, "utf-8").split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const text = codeOnly(lines[i]);
      if (text !== "" && CALL_RE.test(text)) {
        sites.push({ file, line: i + 1, text });
      }
    }
  }
  return sites;
}

/** A site is covered when a whitelist entry names its file and code fragment. */
function isAllowed(site: CodeSite): boolean {
  return ALLOWED.some(
    entry => entry.file === site.file && site.text.includes(entry.code),
  );
}

const describeSite = (site: CodeSite) => `${site.file}:${site.line} — ${site.text}`;

describe("bare-timer guard", () => {
  const sites = codeSites();

  it("delayed work goes through the timer owner, not a bare setTimeout/setInterval/rAF", () => {
    const offenders = sites.filter(site => !isAllowed(site));
    expect(
      offenders.map(describeSite),
      "give the callback a timer owner (createTimers()) or add a whitelist entry naming why the raw call is the step",
    ).toEqual([]);
  });

  it("every whitelist entry still matches live code", () => {
    const stale = ALLOWED.filter(
      entry =>
        !sites.some(site => site.file === entry.file && site.text.includes(entry.code)),
    );
    expect(
      stale.map(entry => `${entry.file} — ${entry.code}`),
      "the code moved or changed: re-point or delete the entry instead of widening the exemption",
    ).toEqual([]);
  });

  it("every whitelist entry names a real reason", () => {
    const thin = ALLOWED.filter(
      entry => entry.reason.trim().length < MIN_REASON_LENGTH,
    );
    expect(
      thin.map(entry => entry.file),
      `the reason must say why the site has no owner (at least ${MIN_REASON_LENGTH} characters)`,
    ).toEqual([]);
  });
});
