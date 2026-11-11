// The layer-events contract guard: `LAYER_EVENTS` is the declared layer-domain
// subset of `EVENTS`, and the `foliplus:layer:` prefix is a public convention.
// This test pins the two invariants the set exists to protect:
//
//   1. `LAYER_EVENTS` and "every `foliplus:layer:` value in `EVENTS`" are the
//      same set, both ways — a new layer event added to `EVENTS` that is not
//      registered here is a failure, and so is an entry here whose EVENTS
//      value stopped being a layer event.
//   2. every value in `LAYER_EVENTS` really does start with `foliplus:layer:` —
//      a typo in a hand-maintained entry cannot silently widen the domain.
//
// The set is deliberately a hand-written enumeration, not a runtime
// `startsWith` filter: a filter would make the guard a tautology (it would
// always agree with itself). The comparison below is what gives the
// enumeration teeth — it derives the expected set from an `EVENTS` view it is
// handed (so a hypothetical new event can be injected into that view without
// touching the production constant) and fails on any drift, in either
// direction.
import { describe, expect, it } from "vitest";
import { EVENTS, LAYER_EVENTS } from "#core/event/index.js";

const LAYER_PREFIX = "foliplus:layer:";

/** Compare a candidate set against the layer events derived from an `EVENTS`
 *  view. The view is a parameter so a hypothetical new event can be injected
 *  into it without mutating the production `EVENTS` constant. Both directions
 *  are asserted so a missing entry and an extra entry are two distinct,
 *  legible failures. */
const expectLayerSetMatchesEvents = (
  candidate: Readonly<Record<string, string>>,
  eventsView: Readonly<Record<string, string>> = EVENTS,
): void => {
  const derived = Object.values(eventsView).filter(value =>
    value.startsWith(LAYER_PREFIX),
  );
  const declared: string[] = Object.values(candidate);

  // Every declared entry is a real EVENTS value (catches a stale key whose
  // EVENTS spelling was renamed under it).
  const eventsSet = new Set<string>(Object.values(eventsView));
  const stale = declared.filter(value => !eventsSet.has(value));
  expect(stale).toEqual([]);

  // Every layer event is declared — the missing direction, the common
  // regression: `EVENTS` gains a `foliplus:layer:` event and the contributor
  // forgets to add it to `LAYER_EVENTS`.
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

  it("a layer event added to EVENTS but not registered here fails (missing)", () => {
    // The high-frequency regression: a contributor adds a new `foliplus:layer:`
    // event to EVENTS and forgets to register it in LAYER_EVENTS. Inject the
    // hypothetical into the EVENTS *view* (not the production constant) — the
    // comparator must report it as missing and go red. The production EVENTS
    // is left untouched.
    const eventsWithNewThing = {
      ...EVENTS,
      LAYER_NEW_THING: "foliplus:layer:new-thing",
    };
    expect(() =>
      expectLayerSetMatchesEvents(LAYER_EVENTS, eventsWithNewThing),
    ).toThrow();
  });

  it("an entry registered here that EVENTS does not carry fails (extra)", () => {
    // The opposite drift: an entry whose EVENTS value is retired or renamed,
    // or a hand-added entry with no EVENTS backing. Inject the hypothetical
    // into the candidate set — the comparator must report it as extra.
    const candidateWithExtra = {
      ...LAYER_EVENTS,
      HYPOTHETICAL: "foliplus:layer:hypothetical" as string,
    };
    expect(() => expectLayerSetMatchesEvents(candidateWithExtra)).toThrow();
  });
});
