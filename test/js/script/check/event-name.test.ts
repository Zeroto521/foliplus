// Guard test for `script/check/event-name.mjs` — the semantic event-name
// convention. The script's pure checker `findEventNameDrift` pins the
// `<domain>:<action>` shape over `EVENTS` entries and keeps the layer domain
// on the `foliplus:layer:` prefix. These cases drive the checker directly
// against synthetic entry lists (the real dictionary is covered by the
// script's own CLI run in CI), so each red case injects one hypothetical name
// without mutating the production constant.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { EVENTS } from "#core/event/index.js";
import {
  findEventNameDrift,
  main,
  parseEvents,
  runCli,
} from "#script/check/event-name.mjs";

const CONST_PATH = path.join(
  process.cwd(),
  "foliplus",
  "js",
  "core",
  "event",
  "const.ts",
);

/** The real parsed EVENTS entries (the script's CLI parses the same file). */
const realEntries = () => parseEvents(readFileSync(CONST_PATH, "utf8"));

/** The set of domains the real dictionary publishes — the known-domain set the
 *  CLI derives and the shape check uses to flag a name in an unknown domain. */
const knownDomains = () =>
  new Set(
    realEntries()
      .map(e => e.value.split(":")[1])
      .filter(Boolean),
  );

/** Build a synthetic entry list: the real dictionary with one entry's value
 *  replaced (key preserved). `line` is retained from the real entry. */
const withValue = (key, value) =>
  realEntries().map(e => (e.key === key ? { ...e, value } : e));

/** Build a synthetic entry list with one extra hypothetical entry. */
const withExtra = (key, value) => [...realEntries(), { key, value, line: 0 }];

describe("event-name guard", () => {
  it("passes on the real EVENTS dictionary", () => {
    expect(findEventNameDrift(realEntries(), knownDomains())).toEqual([]);
  });

  it("flags a name with an unknown domain (foliplus:unknown:foo)", () => {
    // `unknown` parses as a legal kebab-case domain (shape passes) but is not
    // in the set the real dictionary publishes. A subscriber listening for the
    // panel's events would never see it — the known-domain check reports it as
    // a routing break.
    const violations = findEventNameDrift(
      withExtra("HYPOTHETICAL", "foliplus:unknown:foo"),
      knownDomains(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("HYPOTHETICAL");
    expect(violations[0].reason).toMatch(/domain "unknown" is not a published domain/);
  });

  it("flags a layer event missing its action segment (foliplus:layer:)", () => {
    // The likely hand-edit slip: a new layer event is added with the domain
    // and colon but the action never typed. The shape regex rejects the empty
    // third segment.
    const violations = findEventNameDrift(
      withExtra("LAYER_NEW_THING", "foliplus:layer:"),
      knownDomains(),
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("LAYER_NEW_THING");
    expect(violations[0].reason).toMatch(/is not `foliplus:<domain>:<action>`/);
  });

  it("accepts the real layer event (foliplus:layer:change)", () => {
    expect(EVENTS.LAYER_CHANGE).toBe("foliplus:layer:change");
    expect(
      findEventNameDrift(
        [{ key: "LAYER_CHANGE", value: EVENTS.LAYER_CHANGE }],
        knownDomains(),
      ),
    ).toEqual([]);
  });

  it("flags an empty layer domain (no foliplus:layer: event at all)", () => {
    // If the dictionary ever lost every layer event, the panel's whole
    // channel would be gone. Shape-only (no known-domain set) so the missing
    // layer domain is what is reported, not every unknown domain.
    const violations = findEventNameDrift(
      [
        { key: "MODE_CHANGE", value: "foliplus:mode:change" },
        { key: "BEFORE_EXPORT", value: "foliplus:export:before" },
      ],
      undefined,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0].key).toBe("(dictionary)");
    expect(violations[0].reason).toMatch(/no `foliplus:layer:` event/);
  });

  it("flags a LAYER_ key carrying a non-layer value (LAYER_CHANGE -> foliplus:mode:change)", () => {
    // A hand-edit swaps the domain on a layer event: the shape is fine and
    // "mode" is a published domain, so the shape + known-domain checks pass.
    // The key→domain association is what catches it — a LAYER_ key must carry
    // the foliplus:layer: value prefix.
    const violations = findEventNameDrift(
      withValue("LAYER_CHANGE", "foliplus:mode:change"),
      knownDomains(),
    );
    expect(
      violations.some(v => v.key === "LAYER_CHANGE" && /LAYER_ key/.test(v.reason)),
    ).toBe(true);
  });

  it("flags a LAYER_ key with a typo domain (LAYER_CHANGE -> foliplus:laryer:change)", () => {
    // A typo in the domain segment: "laryer" is a valid kebab-case segment so
    // the shape passes, but the known-domain check flags it as unpublished and
    // the key→domain association flags the LAYER_ key carrying a non-layer
    // value — at least one violation names LAYER_CHANGE.
    const violations = findEventNameDrift(
      withValue("LAYER_CHANGE", "foliplus:laryer:change"),
      knownDomains(),
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
    expect(violations.some(v => v.key === "LAYER_CHANGE")).toBe(true);
  });

  it("flags a non-LAYER_ key carrying a layer value (MODE_CHANGE -> foliplus:layer:change)", () => {
    // The reverse direction: a mode event accidentally typed with the layer
    // prefix. The key→domain association catches it — a non-LAYER_ key must
    // not carry the foliplus:layer: value prefix (OVERLAY_CLEAR is the one
    // exempted key, and this is not it).
    const violations = findEventNameDrift(
      withValue("MODE_CHANGE", "foliplus:layer:change"),
      knownDomains(),
    );
    expect(
      violations.some(v => v.key === "MODE_CHANGE" && /non-LAYER_ key/.test(v.reason)),
    ).toBe(true);
  });

  it("parseEvents returns empty when the source has no EVENTS literal", () => {
    // A const.ts that lost its dictionary entirely: the parser returns no
    // entries rather than throwing, so the CLI reports an empty (not a
    // malformed) dictionary.
    expect(parseEvents("// no dictionary here\n")).toEqual([]);
  });
});

describe("event-name CLI", () => {
  it("main returns 0 and logs the all-clear on the real dictionary", () => {
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      log.push(args.join(" "));
    });
    try {
      expect(main(process.cwd())).toBe(0);
      expect(log.some(l => l.includes("every EVENTS value follows"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("main returns 1 and prints file:line on a malformed dictionary", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "event-name-"));
    const constDir = path.join(dir, "foliplus", "js", "core", "event");
    mkdirSync(constDir, { recursive: true });
    writeFileSync(
      path.join(constDir, "const.ts"),
      'const EVENTS = {\n  BAD: "not-an-event-name",\n} as const;\n',
    );
    const log: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      log.push(args.join(" "));
    });
    try {
      expect(main(dir)).toBe(1);
      expect(log.some(l => l.includes("BAD") && l.includes(":"))).toBe(true);
    } finally {
      spy.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runCli wires main to process.exitCode when this file is the entry", () => {
    const original = process.exitCode;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runCli([], import.meta.url);
      expect(process.exitCode).toBe(0);
    } finally {
      process.exitCode = original;
      spy.mockRestore();
    }
  });

  it("runCli is a no-op when the entry is not this script", () => {
    const original = process.exitCode;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      runCli([], "some/other/file.mjs");
      expect(spy).not.toHaveBeenCalled();
    } finally {
      process.exitCode = original;
      spy.mockRestore();
    }
  });
});
