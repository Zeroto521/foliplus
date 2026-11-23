// Guard test for script/check/event-origin.mjs — every semantic event
// publish carries an origin ({ kind: ... }) or an adjacent origin-exempt
// comment. The pure checker findOriginDrift pins the rule over a source
// string, so each case drives the checker directly against a synthetic
// snippet (the real call sites are covered by the script's own CLI run).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { findOriginDrift, runCli, scan } from "#script/check/event-origin.mjs";

const EVENTS_SRC = 'import { EVENTS } from "#core/event/index.js";\n';

const check = (body: string) => findOriginDrift(EVENTS_SRC + body, "synthetic.ts");

describe("event-origin: bus calls must carry an origin", () => {
  it("flags a publish with no origin", () => {
    const v = check(
      "const bus = new EventBus();\n" +
        'bus.publish(EVENTS.LAYER_CHANGE, { id: "a" });\n',
    );
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
    expect(v[0].message).toContain("LAYER_CHANGE");
  });

  it("accepts a publish with an origin literal", () => {
    const v = check(
      "const bus = new EventBus();\n" +
        'bus.publish(EVENTS.LAYER_CHANGE, { id: "a" }, { kind: "user", via: "panel" });\n',
    );
    expect(v).toHaveLength(0);
  });

  it("accepts a publish with an origin-exempt comment", () => {
    const v = check(
      "const bus = new EventBus();\n" +
        "// origin-exempt: synthetic test fixture\n" +
        'bus.publish(EVENTS.LAYER_CHANGE, { id: "a" });\n',
    );
    expect(v).toHaveLength(0);
  });

  it("ignores a bare-string emit (module-local event, not a bus call)", () => {
    const v = check(
      "const s = new Slider();\n" + 's.emit("input");\n' + 's.emit("change");\n',
    );
    expect(v).toHaveLength(0);
  });

  it("flags an operation emit with no origin", () => {
    const v = check(
      "const op = new SettledOperation();\n" +
        'op.emit(EVENTS.LAYER_ITEM_ADDED, { id: "a" });\n',
    );
    expect(v).toHaveLength(1);
  });

  it("flags a free-function publish with no origin", () => {
    const v = check(
      "const bus = new EventBus();\n" +
        'publish(bus, EVENTS.LAYER_CHANGE, { id: "a" });\n',
    );
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("LAYER_CHANGE");
  });

  it("accepts a free-function publish with an origin literal", () => {
    const v = check(
      "const bus = new EventBus();\n" +
        'publish(bus, EVENTS.LAYER_CHANGE, { id: "a" }, { kind: "programmatic", via: "init" });\n',
    );
    expect(v).toHaveLength(0);
  });

  it("accepts a publish whose origin is a reference to an origin-shaped constant", () => {
    // `isOriginArg` also recognises a binding (`const ORIGIN = { kind: ... }`)
    // passed by name, not by literal: the guard cannot inline-check a reference, so
    // the identifier/property-access arm returns true.
    const v = check(
      "const bus = new EventBus();\n" +
        'const ORIGIN = { kind: "user", via: "panel" };\n' +
        'bus.emit(EVENTS.LAYER_CHANGE, { id: "a" }, ORIGIN);\n',
    );
    expect(v).toHaveLength(0);
  });
  it("ignores a call whose event arg is not an EVENTS member", () => {
    // The eventNameOf arm: only `EVENTS.UPPER_SNAKE` spells a semantic event.
    // A lower-case member (`EVENTS.foo`) is not a bus event name — the checker
    // returns null and the call is not scanned for an origin, so no violation.
    const v = check(
      "const bus = new EventBus();\n" + 'bus.emit(EVENTS.notAnEvent, { id: "a" });\n',
    );
    expect(v).toHaveLength(0);
  });
  it("flags a publish whose origin slot holds a non-origin value", () => {
    // A trailing argument that is neither an object literal, an identifier nor
    // a property access (here: a numeric literal) is not an origin — `isOriginArg`
    // falls through to its `return false` and the publish is still a violation.
    const v = check(
      "const bus = new EventBus();\n" +
        "bus.emit(EVENTS.LAYER_CHANGE, { id: 'a' }, 42);\n",
    );
    expect(v).toHaveLength(1);
    expect(v[0].line).toBe(3);
  });
});

describe("event-origin: scan and CLI", () => {
  /** The checker's own contract, as a production .ts file: one clean
   *  publish and one that omits the origin. `scan` must find exactly
   *  the offender and report its path relative to the root. */
  const CLEAN =
    'import { EVENTS } from "#core/event/index.js";' +
    "\n" +
    "const bus = new EventBus();\n" +
    "bus.emit(EVENTS.LAYER_CHANGE, { id: 'a' }, { kind: 'user', via: 'panel' });\n";

  const BAD =
    'import { EVENTS } from "#core/event/index.js";' +
    "\n" +
    "const bus = new EventBus();\n" +
    "bus.emit(EVENTS.LAYER_CHANGE, { id: 'a' });\n";

  it("scan reports the offender path and line inside the root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evorigin-scan-"));
    try {
      fs.mkdirSync(path.join(root, "foliplus", "js"), { recursive: true });
      fs.writeFileSync(path.join(root, "foliplus/js", "clean.ts"), CLEAN);
      fs.writeFileSync(path.join(root, "foliplus/js", "bad.ts"), BAD);
      const v = scan(root);
      expect(v).toHaveLength(1);
      expect(v[0].file).toBe("foliplus" + "/" + "js" + "/" + "bad.ts");
      expect(v[0].line).toBe(3);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runCli exits 0 and reports clean when every publish carries an origin", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evorigin-cli-ok-"));
    try {
      fs.mkdirSync(path.join(root, "foliplus", "js"), { recursive: true });
      fs.writeFileSync(path.join(root, "foliplus/js", "clean.ts"), CLEAN);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(runCli([root])).toBe(0);
        expect(log).toHaveBeenCalledWith(
          "event-origin: OK \u2014 every publish carries an origin",
        );
      } finally {
        log.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("runCli falls back to the process working directory when argv is empty", () => {
    // The `argv[0] || process.cwd()` default: runCli() with no explicit root
    // scans the process working directory. Vitest workers cannot chdir, so
    // point `process.cwd` at a clean throwaway instead — the fallback arm is
    // what runs, not a chdir.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evorigin-cwd-"));
    try {
      fs.mkdirSync(path.join(root, "foliplus", "js"), { recursive: true });
      fs.writeFileSync(path.join(root, "foliplus/js", "clean.ts"), CLEAN);
      const cwd = vi.spyOn(process, "cwd").mockReturnValue(root);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        // Pass an empty argv: the default `process.argv.slice(2)` would carry
        // vitest's own args, and a truthy argv[0] would skip the fallback.
        expect(runCli([])).toBe(0);
        expect(cwd).toHaveBeenCalled();
      } finally {
        cwd.mockRestore();
        log.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("scan walks nested directories and ignores non-TypeScript files", () => {
    // The walk recurses into subdirectories (the `entry.isDirectory` arm) and
    // skips files that do not end in .ts (the non-TypeScript arm): a .css or
    // .json file in the tree is never scanned for bus calls.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evorigin-walk-"));
    try {
      fs.mkdirSync(path.join(root, "foliplus", "js", "core", "layer"), {
        recursive: true,
      });
      fs.writeFileSync(path.join(root, "foliplus/js/core/layer", "nested.ts"), BAD);
      fs.writeFileSync(path.join(root, "foliplus/js", "styles.css"), BAD);
      fs.writeFileSync(path.join(root, "foliplus/js", "manifest.json"), BAD);
      const v = scan(root);
      // Only the .ts file inside the nested directory is scanned — the .css
      // and .json files sit at the top of the tree, are skipped, and would
      // otherwise each report the same violation three times over.
      expect(v).toHaveLength(1);
      // `scan` reports paths with forward slashes regardless of the host
      // separator, so the nested file is named with `/` throughout.
      expect(v[0].file).toBe("foliplus/js/core/layer/nested.ts");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it("runCli exits 1, names each violation and counts them", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "evorigin-cli-bad-"));
    try {
      fs.mkdirSync(path.join(root, "foliplus", "js"), { recursive: true });
      fs.writeFileSync(path.join(root, "foliplus/js", "bad.ts"), BAD);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      try {
        expect(runCli([root])).toBe(1);
        const calls = log.mock.calls.map(c => c.join(" "));
        const named = calls.filter(s => s.includes("bad.ts"));
        expect(named).toHaveLength(1);
        expect(named[0]).toMatch(
          /^foliplus\/.+\.ts:\d+: (?:publish|emit)\(\) for EVENTS\.LAYER_CHANGE must pass an origin/,
        );
        expect(calls.some(s => s.includes("violation"))).toBe(true);
      } finally {
        log.mockRestore();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
