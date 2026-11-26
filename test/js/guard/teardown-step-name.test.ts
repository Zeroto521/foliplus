// Guard test: one unique, greppable teardown step name per semantic event.
//
// LayerControl names each teardown step after the bus event it unsubscribes,
// so a failure report can say "layer-item-count-change" instead of a queue
// index. The derivation flattens both the ":" separators and the "-" inside a
// segment into one character, which is only injective while no event mixes the
// two: "foliplus:foo-bar:baz" and "foliplus:foo:bar-baz" both derive
// "foo-bar-baz". A collision would silently point a teardown failure at the
// wrong subscription, so the EVENTS dictionary is checked against the
// production derivation itself.
import { describe, expect, it } from "vitest";
import { EVENTS } from "#core/event/index.js";
import { teardownStepName } from "#control/LayerControl/ui/lifecycle.js";

const STEP_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Step names claimed by more than one event, in first-seen order. */
const collisions = (events: readonly string[]): string[] => {
  const counts = new Map<string, number>();
  for (const event of events) {
    const name = teardownStepName(event);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([name]) => name);
};

describe("teardown step names", () => {
  it("derives one unique, kebab-case step name for every event", () => {
    const events = Object.values(EVENTS);
    expect(events.length).toBeGreaterThan(0);
    expect(collisions(events), "two events flatten to one step name").toEqual([]);

    const offShape = events
      .map(teardownStepName)
      .filter(name => STEP_NAME.test(name) === false);
    expect(offShape, "a step name must stay greppable").toEqual([]);
  });

  it("flags a hyphenated segment colliding with a nested one", () => {
    // The exact ambiguity the derivation admits: without this guard the pair
    // would look fine one name at a time.
    const colliding = ["foliplus:foo-bar:baz", "foliplus:foo:bar-baz"];
    expect(teardownStepName(colliding[0])).toBe("foo-bar-baz");
    expect(collisions(colliding)).toEqual(["foo-bar-baz"]);
  });

  it("keeps the bus prefix out of the step name", () => {
    // The scope reports failures by this name; a stray prefix would read as
    // part of the step and break a grep for the event it belongs to.
    for (const event of Object.values(EVENTS)) {
      expect(teardownStepName(event).startsWith("foliplus")).toBe(false);
    }
    expect(teardownStepName("not-prefixed:layer:change")).toBe(
      "not-prefixed-layer-change",
    );
  });
});
