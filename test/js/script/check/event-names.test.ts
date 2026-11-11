// Guard test for `script/check/event-names.mjs` — the semantic event-name
// convention. The script's pure checker `findEventNameDrift` pins the
// `<domain>:<action>` shape over `EVENTS` entries and keeps the layer domain
// on the `foliplus:layer:` prefix. These cases drive the checker directly
// against synthetic entry lists (the real dictionary is covered by the
// script's own CLI run in CI), so each red case injects one hypothetical name
// without mutating the production constant.
import {
  findEventNameDrift,
  parseEvents,
} from "../../../../script/check/event-names.mjs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENTS } from "#core/event/index.js";

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

/** Build a synthetic entry list: the real dictionary plus one hypothetical
 *  entry. `line` is 0 because the entry is not in the file. */
const withExtra = (key: string, value: string) => [
  ...realEntries(),
  { key, value, line: 0 },
];

describe("event-names guard", () => {
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
});
