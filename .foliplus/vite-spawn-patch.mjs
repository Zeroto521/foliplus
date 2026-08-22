// tools/vite-spawn-patch.mjs
//
// Pseudo-entry shim: prepend `import './tools/vite-spawn-patch.mjs'` at the
// top of node_modules/vitest/vitest.mjs so the patch runs in the main
// process AND in every vitest fork/thread worker (which bootstrap through
// the same vitest.mjs).
//
// Under the DSH Windows sandbox `child_process.spawn` is EPERM for any
// new process. Vite 8's config loader calls `exec("net use")` (inside
// optimizeSafeRealPathSync) to map network drives before resolving the
// config file's real path; that spawn is the *only* subprocess the test
// harness needs, and it otherwise crashes startup. Pure in-process unit
// tests never need a real child process, so benign commands are faked and
// everything else is let through to the real impl.

import cp from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

const _spawn         = cp.spawn;
const _exec          = cp.exec;
const _execFile      = cp.execFile;
const _spawnSync     = cp.spawnSync;
const _execSync      = cp.execSync;
const _execFileSync  = cp.execFileSync;

function isIntercept(command, args) {
  const c = String(command || "");
  if (/^net(\.exe)?$/i.test(c)) return true;
  if (/^cmd(\.exe)?$/i.test(c)) return true;
  if (c === "net use") return true;
  return false;
}

function fakeCP() {
  const out = new PassThrough();
  const err = new PassThrough();
  const ev = new EventEmitter();
  ev.stdout = out;
  ev.stderr = err;
  ev.stdin = new PassThrough();
  ev.pid = 0;
  ev.kill = function () { this.emit("exit", 0, null); this.emit("close", 0, null); };
  setImmediate(() => { out.end(); err.end(); ev.emit("close", 0, null); ev.emit("exit", 0, null); });
  return ev;
}

function maybeReal(fn, ...a) {
  try { return fn.apply(cp, a); }
  catch (e) {
    if (e && e.code === "EPERM") return null;
    throw e;
  }
}

cp.spawn = function (command, args, opts) {
  if (isIntercept(command, args)) return fakeCP();
  const r = maybeReal(_spawn, command, args, opts);
  return r || fakeCP();
};

cp.exec = function (file, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = undefined; }
  if (typeof cb !== "function") cb = function () {};
  const ev = fakeCP();
  if (isIntercept(file, Array.isArray(opts) ? opts : null)) {
    setImmediate(() => cb(null, "", ""));
    return ev;
  }
  const real = maybeReal(_exec, file, opts, cb);
  return real || ev;
};

cp.execFile = function (file, args, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = undefined; }
  if (typeof cb !== "function") cb = function () {};
  const ev = fakeCP();
  if (isIntercept(file, args)) {
    setImmediate(() => cb(null, "", ""));
    return ev;
  }
  const real = maybeReal(_execFile, file, args, opts, cb);
  return real || ev;
};

cp.spawnSync = function (command, args, opts) {
  if (isIntercept(command, args))
    return { status: 0, error: null, stdout: "", stderr: "", pid: 0 };
  const r = maybeReal(_spawnSync, command, args, opts);
  return r || { status: 1, error: new Error("EPERM (sandbox)"), stdout: "", stderr: "", pid: 0 };
};

cp.execSync = function (file, opts) {
  if (isIntercept(file, Array.isArray(opts) ? opts : (opts && opts.args))) return "";
  const r = maybeReal(_execSync, file, opts);
  return r || "";
};

cp.execFileSync = function (file, args, opts) {
  if (isIntercept(file, args)) return "";
  const r = maybeReal(_execFileSync, file, args, opts);
  return r || "";
};
