// Guard test for script/check/event-origin.mjs — every semantic event
// publish carries an origin ({ kind: ... }) or an adjacent origin-exempt
// comment. The pure checker findOriginDrift pins the rule over a source
// string, so each case drives the checker directly against a synthetic
// snippet (the real call sites are covered by the script's own CLI run).
import { describe, expect, it } from "vitest";
import { findOriginDrift } from "#script/check/event-origin.mjs";

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
});
