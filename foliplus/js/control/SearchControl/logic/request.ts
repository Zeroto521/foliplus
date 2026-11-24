// SearchControl/logic/request — the single in-flight gate for every async read.
//
// The control issues three independent reads: address geocode, autocomplete and
// reverse geocode. Each used to carry its own cancellation discipline — or none
// at all: only suggestions had a sequence and an AbortController, so a late
// address response could fly the map back to A after the user had searched B,
// and could still place a pin after the control was removed. Every read now takes
// a sequence from `beginRequest` and must pass `requestCurrent` before it touches
// the map, the panel or the hint; teardown calls `invalidateRequests`.
//
// foliplus.geocode() takes no AbortSignal, so a superseded request still runs to
// completion — the gate makes its result inert instead of cancelling the fetch.

/** Independent read paths — a new request only supersedes its own path. */
const REQUEST_PATHS = ["address", "suggest", "reverse"] as const;
type RequestPath = (typeof REQUEST_PATHS)[number];

/** The control state every request path shares. */
interface RequestGates {
  /** True once destroyControl() ran; a late result must never land after it. */
  disposed: boolean;
  addrSeq: number;
  suggestSeq: number;
  reverseSeq: number;
}

/** Which counter belongs to each path — the one place a new path registers. */
const REQUEST_SEQ_FIELD = {
  address: "addrSeq",
  suggest: "suggestSeq",
  reverse: "reverseSeq",
} as const satisfies Record<RequestPath, keyof RequestGates>;

/** Current counter value; tolerates a partially built control / test fixture. */
const seqOf = (gates: RequestGates, path: RequestPath): number =>
  gates[REQUEST_SEQ_FIELD[path]] ?? 0;

/** Take the newest sequence for `path`; capture it for the late-result check. */
const beginRequest = (gates: RequestGates, path: RequestPath): number => {
  const next = seqOf(gates, path) + 1;
  gates[REQUEST_SEQ_FIELD[path]] = next;
  return next;
};

/**
 * True while `seq` is still the newest request on `path` and the control has
 * not been disposed. Every async handler checks this before touching the control.
 */
const requestCurrent = (gates: RequestGates, path: RequestPath, seq: number): boolean =>
  !gates.disposed && seqOf(gates, path) === seq;

/** Teardown: retire every in-flight request and mark the control disposed. */
const invalidateRequests = (gates: RequestGates): void => {
  gates.disposed = true;
  for (const path of REQUEST_PATHS) {
    gates[REQUEST_SEQ_FIELD[path]] = seqOf(gates, path) + 1;
  }
};

export { REQUEST_PATHS, beginRequest, invalidateRequests, requestCurrent };
export type { RequestGates, RequestPath };
