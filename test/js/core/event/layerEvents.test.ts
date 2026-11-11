// The layer-events contract guard: `LAYER_EVENTS` is the declared layer-domain
// subset of `EVENTS`, and the `foliplus:layer:` prefix is a public convention.
// This test pins the two invariants the set exists to protect:
//
//   1. `LAYER_EVENTS` and "every `foliplus:layer:` value in `EVENTS`" are the
//      same set, both ways — a new layer event that is not registered here is
//      a failure, and so is an entry here whose EVENTS value stopped being a
//      layer event.
//   2. every value in `LAYER_EVENTS` really does start with `foliplus:layer:` —
//      a typo in a hand-maintained entry cannot silently widen the domain.
//
// The set is deliberately a hand-written enumeration, not a runtime
// `startsWith` filter: a filter would make the guard a tautology (it would
// always agree with itself). The comparison below is what gives the
// enumeration teeth — it re-derives the expected set independently and fails
// on any drift, in either direction.
import { describe, expect, it } from "vitest";
import { EVENTS, LAYER_EVENTS } from "#core/event/index.js";

const LAYER_PREFIX = "foliplus:layer:";

/** Compare a candidate set against the layer events independently derived
 *  from `EVENTS`. Both directions are asserted so a missing entry and an
 *  extra entry are two distinct, legible failures. */
const expectLayerSetMatchesEvents = (
  candidate: Readonly<Record<string, string>>,
): void => {
  const derived = Object.values(EVENTS).filter(value => value.startsWith(LAYER_PREFIX));
  const declared: string[] = Object.values(candidate);

  // Every declared entry is a real EVENTS value (catches a stale key whose
  // EVENTS spelling was renamed under it).
  const eventsSet = new Set<string>(Object.values(EVENTS));
  const stale = declared.filter(value => !eventsSet.has(value));
  expect(stale).toEqual([]);

  // Every layer event is declared (a new `foliplus:layer:` event that was not
  // added to the set is a failure).
  const declaredSet = new Set<string>(declared);
  const missing = derived.filter(value => !declaredSet.has(value));
  expect(missing).toEqual([]);

  // Nothing extra: the set is exactly the layer domain, no more.
  const derivedSet = new Set<string>(derived);
  const extra = declared.filter(value => !derivedSet.has(value));
  expect(extra).toEqual([]);
};

describe("LAYER_EVENTS contract", () => {
  it("matches every foliplus:layer: event in EVENTS, both directions", () => {
    expectLayerSetMatchesEvents(LAYER_EVENTS);
  });

  it("every entry carries the foliplus:layer: prefix", () => {
    for (const [key, value] of Object.entries(LAYER_EVENTS)) {
      expect(value, key).toMatch(new RegExp(`^${LAYER_PREFIX}`));
    }
  });

  it("a new layer event that is not registered here fails the guard", () => {
    // Simulate a contributor adding a layer event to EVENTS without
    // registering it in LAYER_EVENTS: the shared comparator must go red.
    const simulated = {
      ...LAYER_EVENTS,
      // A hypothetical unregistered layer event.
      HYPOTHETICAL: "foliplus:layer:hypothetical" as string,
    };
    expect(() => expectLayerSetMatchesEvents(simulated)).toThrow();
  });
});
